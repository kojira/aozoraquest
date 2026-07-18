import { describe, it, expect, afterEach } from 'vitest';
import { rkeyForDid, readModifyWrite, GAME_STATE_COLLECTION, type GameState } from '../src/game-state';
import type { PdsSession } from '../src/pds';

const session: PdsSession = { pdsUrl: 'https://pds.example', accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:server' };
const NOW = '2026-07-18T00:00:00.000Z';
const DID = 'did:plc:alice';

/** ステートフルな PDS モック (swapRecord CAS を本物どおり実装)。`interferer` を渡すと
 *  最初の putRecord の直前に「別リクエストが割り込んで書いた」状況を作れる (CAS 競合テスト用)。 */
function statefulPds(interferer?: (store: Map<string, { value: unknown; cid: string }>) => void) {
  const store = new Map<string, { value: unknown; cid: string }>();
  let counter = 0;
  let putCalls = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('com.atproto.repo.getRecord')) {
      const rkey = new URL(url).searchParams.get('rkey')!;
      const rec = store.get(rkey);
      return rec ? json(200, { uri: `at://${rkey}`, cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    if (url.includes('com.atproto.repo.putRecord')) {
      putCalls++;
      if (putCalls === 1 && interferer) interferer(store); // 1 回目の put 直前に競合を注入
      const b = JSON.parse(init.body as string) as { rkey: string; record: unknown; swapRecord?: string | null };
      const cur = store.get(b.rkey);
      if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      const cid = `cid${++counter}`;
      store.set(b.rkey, { value: b.record, cid });
      return json(200, { uri: `at://${b.rkey}`, cid });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
  return { fn, store, get putCalls() { return putCalls; } };
}

describe('game-state', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('rkeyForDid は決定的で rkey 有効文字のみ', () => {
    const rk = rkeyForDid(DID);
    expect(rk).toBe(rkeyForDid(DID));
    expect(rk).toMatch(/^u[0-9a-f]{32}$/);
    expect(rkeyForDid('did:web:example.com')).not.toBe(rk);
  });

  it('state 無しなら初期値から作成 (swap=null で新規作成のみ)', async () => {
    const m = statefulPds();
    globalThis.fetch = m.fn;
    const s = await readModifyWrite(session, DID, (c) => ({ ...c, power: c.power + 3 }), { now: NOW });
    expect(s.power).toBe(3);
    expect(s.did).toBe(DID);
    expect(m.store.get(rkeyForDid(DID))).toBeTruthy();
  });

  it('既存 state を読んで mutate し CAS で更新', async () => {
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await readModifyWrite(session, DID, (c) => ({ ...c, power: 10 }), { now: NOW });
    const s2 = await readModifyWrite(session, DID, (c) => ({ ...c, power: c.power - 1 }), { now: NOW });
    expect(s2.power).toBe(9);
  });

  it('CAS 競合時は最新を読み直して再評価する (二重使用を通さない = ★★★ 契約)', async () => {
    // 事前に power:100 を作成
    const m = statefulPds((store) => {
      // 1 回目の put 直前に「別端末が power を 100→50 に消費して書いた」状況を注入
      const rk = rkeyForDid(DID);
      store.set(rk, { value: { did: DID, power: 50, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 0, y: 0, version: 1, updatedAt: NOW }, cid: 'cidX' });
    });
    globalThis.fetch = m.fn;
    // 先に power:100 のレコードを作る (この時点では interferer は putCalls===1 で発火するので注意)
    // → 別のモックで素直に作成する
    const setup = statefulPds();
    globalThis.fetch = setup.fn;
    await readModifyWrite(session, DID, (c) => ({ ...c, power: 100 }), { now: NOW });
    // 以後は競合注入つきモックに切替え、power を 30 消費する RMW を実行
    // (注入により最初の read は power:100 だが put が競合 → 再読込で power:50 になり、そこから -30)
    const store2 = setup.store;
    let interfered = false;
    const m2fetch = (async (url: string, init: RequestInit = {}) => {
      const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
      if (url.includes('getRecord')) {
        const rk = new URL(url).searchParams.get('rkey')!;
        const rec = store2.get(rk)!;
        return json(200, { uri: 'x', cid: rec.cid, value: rec.value });
      }
      const b = JSON.parse(init.body as string) as { rkey: string; record: GameState; swapRecord?: string | null };
      if (!interfered) {
        interfered = true;
        // 競合注入: 別端末が power を 100→50 に書いた (cid も変わる)
        store2.set(b.rkey, { value: { ...(store2.get(b.rkey)!.value as GameState), power: 50 }, cid: 'cidConcurrent' });
        return json(400, { error: 'InvalidSwap' });
      }
      const cur = store2.get(b.rkey)!;
      if (b.swapRecord !== cur.cid) return json(400, { error: 'InvalidSwap' });
      store2.set(b.rkey, { value: b.record, cid: 'cidFinal' });
      return json(200, { uri: 'x', cid: 'cidFinal' });
    }) as unknown as typeof fetch;
    globalThis.fetch = m2fetch;
    const result = await readModifyWrite(session, DID, (c) => ({ ...c, power: c.power - 30 }), { now: NOW });
    // 100-30=70 でなく、競合後の 50-30=20 になっていること (= 古い値のまま上書きしていない)
    expect(result.power).toBe(20);
  });

  const jsonRes = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const existingRec = { did: DID, power: 5, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 0, y: 0, version: 1, updatedAt: NOW };

  it('CAS 競合が解消しなければ CasExhausted で throw', async () => {
    globalThis.fetch = (async (url: string) =>
      url.includes('getRecord') ? jsonRes(200, { uri: 'x', cid: 'cidA', value: existingRec }) : jsonRes(400, { error: 'InvalidSwap' })) as unknown as typeof fetch;
    await expect(readModifyWrite(session, DID, (c) => ({ ...c, power: c.power + 1 }), { now: NOW, retries: 2 })).rejects.toMatchObject({ xrpcError: 'CasExhausted' });
  });

  it('InvalidSwap 以外のエラー (トークン失効等) は即 throw しリトライしない', async () => {
    let puts = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('getRecord')) return jsonRes(400, { error: 'RecordNotFound' });
      puts++;
      return jsonRes(401, { error: 'ExpiredToken' });
    }) as unknown as typeof fetch;
    await expect(readModifyWrite(session, DID, (c) => c, { now: NOW, retries: 5 })).rejects.toMatchObject({ xrpcError: 'ExpiredToken' });
    expect(puts).toBe(1);
  });

  it('CAS 競合時に mutate が再実行される (契約の可視化)', async () => {
    let puts = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('getRecord')) return jsonRes(200, { uri: 'x', cid: `c${puts}`, value: existingRec });
      puts++;
      return puts === 1 ? jsonRes(400, { error: 'InvalidSwap' }) : jsonRes(200, { uri: 'x', cid: 'cFinal' });
    }) as unknown as typeof fetch;
    let mutateCalls = 0;
    await readModifyWrite(session, DID, (c) => { mutateCalls++; return { ...c, power: c.power + 1 }; }, { now: NOW });
    expect(mutateCalls).toBe(2);
  });
});
