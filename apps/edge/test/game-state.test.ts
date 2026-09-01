import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { rkeyForDid, readModifyWrite, type GameState, type GameStateEnv, sanitizeGear, type OwnedPiece } from '../src/game-state';
import { writeServerTokens } from '../src/oauth-store';

const DID = 'did:plc:alice'; // 対象ユーザー
const SERVER_DID = 'did:plc:testserver'; // 権威 repo の持ち主 (テスト用サーバーアカウント)
const PDS = 'https://pds.example';
const NOW = 1_700_000_000; // epoch 秒 (固定)

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
function mockKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
}
/** bootstrap 済みトークンを持つ env。 */
async function makeEnv(): Promise<GameStateEnv> {
  const kv = mockKv();
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: PDS, authServer: 'https://bsky.social', updatedAt: NOW });
  return { SERVER_DID, OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}

/** ステートフルな PDS モック: public getRecord + DPoP putRecord の swapRecord CAS を実装。
 *  `interferer` を渡すと最初の putRecord 直前に「別リクエストが割り込んで書いた」状況を作れる。 */
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
      if (putCalls === 1 && interferer) interferer(store);
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
  return { fn, store };
}

describe('game-state (OAuth 権威書き込み)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('rkeyForDid は決定的で rkey 有効文字のみ', () => {
    const rk = rkeyForDid(DID);
    expect(rk).toBe(rkeyForDid(DID));
    expect(rk).toMatch(/^u[0-9a-f]{32}$/);
    expect(rkeyForDid('did:web:example.com')).not.toBe(rk);
  });

  it('state 無しなら初期値から作成 (swap=null で新規作成のみ)', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    const s = await readModifyWrite(env, DID, (c) => ({ ...c, power: c.power + 3 }), { now: NOW });
    expect(s.power).toBe(3);
    expect(s.did).toBe(DID);
    expect(m.store.get(rkeyForDid(DID))).toBeTruthy();
  });

  it('既存 state を読んで mutate し CAS で更新', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await readModifyWrite(env, DID, (c) => ({ ...c, power: 10 }), { now: NOW });
    const s2 = await readModifyWrite(env, DID, (c) => ({ ...c, power: c.power - 1 }), { now: NOW });
    expect(s2.power).toBe(9);
  });

  it('CAS 競合時は最新を読み直して再評価する (二重使用を通さない = ★★★ 契約)', async () => {
    const env = await makeEnv();
    // 先に power:100 を作る
    const setup = statefulPds();
    globalThis.fetch = setup.fn;
    await readModifyWrite(env, DID, (c) => ({ ...c, power: 100 }), { now: NOW });
    // 競合注入つきに切替え、power を 30 消費 (最初の read は 100 だが put が競合 → 再読込で 50 → -30)
    const store2 = setup.store;
    let interfered = false;
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
      if (url.includes('getRecord')) {
        const rk = new URL(url).searchParams.get('rkey')!;
        const rec = store2.get(rk)!;
        return json(200, { uri: 'x', cid: rec.cid, value: rec.value });
      }
      const b = JSON.parse(init.body as string) as { rkey: string; record: GameState; swapRecord?: string | null };
      if (!interfered) {
        interfered = true;
        store2.set(b.rkey, { value: { ...(store2.get(b.rkey)!.value as GameState), power: 50 }, cid: 'cidConcurrent' });
        return json(400, { error: 'InvalidSwap' });
      }
      const cur = store2.get(b.rkey)!;
      if (b.swapRecord !== cur.cid) return json(400, { error: 'InvalidSwap' });
      store2.set(b.rkey, { value: b.record, cid: 'cidFinal' });
      return json(200, { uri: 'x', cid: 'cidFinal' });
    }) as unknown as typeof fetch;
    const result = await readModifyWrite(env, DID, (c) => ({ ...c, power: c.power - 30 }), { now: NOW });
    expect(result.power).toBe(20); // 50-30=20 (古い 100 のまま上書きしていない)
  });

  const jsonRes = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const existingRec = { did: DID, power: 5, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 0, y: 0, version: 1, updatedAt: '' };

  it('CAS 競合が解消しなければ CasExhausted で throw', async () => {
    const env = await makeEnv();
    globalThis.fetch = (async (url: string) =>
      url.includes('getRecord') ? jsonRes(200, { uri: 'x', cid: 'cidA', value: existingRec }) : jsonRes(400, { error: 'InvalidSwap' })) as unknown as typeof fetch;
    await expect(readModifyWrite(env, DID, (c) => ({ ...c, power: c.power + 1 }), { now: NOW, retries: 2 })).rejects.toMatchObject({ xrpcError: 'CasExhausted' });
  });

  it('InvalidSwap 以外のエラー (トークン失効等) は即 throw しリトライしない', async () => {
    const env = await makeEnv();
    let puts = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('getRecord')) return jsonRes(400, { error: 'RecordNotFound' });
      puts++;
      return jsonRes(401, { error: 'ExpiredToken' });
    }) as unknown as typeof fetch;
    await expect(readModifyWrite(env, DID, (c) => c, { now: NOW, retries: 5 })).rejects.toMatchObject({ xrpcError: 'ExpiredToken' });
    expect(puts).toBe(1);
  });

  it('CAS 競合時に mutate が再実行される (契約の可視化)', async () => {
    const env = await makeEnv();
    let puts = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('getRecord')) return jsonRes(200, { uri: 'x', cid: `c${puts}`, value: existingRec });
      puts++;
      return puts === 1 ? jsonRes(400, { error: 'InvalidSwap' }) : jsonRes(200, { uri: 'x', cid: 'cFinal' });
    }) as unknown as typeof fetch;
    let mutateCalls = 0;
    await readModifyWrite(env, DID, (c) => { mutateCalls++; return { ...c, power: c.power + 1 }; }, { now: NOW });
    expect(mutateCalls).toBe(2);
  });

  it('最初の InvalidSwap 後にトークン失効 (401) が来たら即 throw (mid-retry を握りつぶさない)', async () => {
    const env = await makeEnv();
    let puts = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('getRecord')) return jsonRes(200, { uri: 'x', cid: `c${puts}`, value: existingRec });
      puts++;
      return puts === 1 ? jsonRes(400, { error: 'InvalidSwap' }) : jsonRes(401, { error: 'ExpiredToken' });
    }) as unknown as typeof fetch;
    await expect(readModifyWrite(env, DID, (c) => ({ ...c, power: c.power + 1 }), { now: NOW })).rejects.toMatchObject({ xrpcError: 'ExpiredToken' });
    expect(puts).toBe(2); // 1回目 InvalidSwap で再試行 → 2回目 401 で打ち止め (spin しない)
  });

  it('mutate が受け取った state をそのまま返したら書かない (変更なしの契約 #548)', async () => {
    const env = await makeEnv();
    let puts = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('getRecord')) return jsonRes(200, { uri: 'x', cid: 'cidA', value: existingRec });
      puts++;
      return jsonRes(200, { uri: 'x', cid: 'cidB' });
    }) as unknown as typeof fetch;
    const out = await readModifyWrite(env, DID, (c) => c, { now: NOW });
    expect(puts).toBe(0);
    expect(out.power).toBe(5); // 既存の state をそのまま返す
    // 同じ内容でも**別オブジェクト**を返したら書く (同一参照だけが合図。深い比較はしない)
    await readModifyWrite(env, DID, (c) => ({ ...c }), { now: NOW });
    expect(puts).toBe(1);
  });

  it('state が無いときは変更なしでも作成する (レコードの作成自体が変更)', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await readModifyWrite(env, DID, (c) => c, { now: NOW });
    expect(m.store.get(rkeyForDid(DID))).toBeTruthy();
  });

  it('書き込みトークン未 bootstrap は fail-closed (ServerWriteError)', async () => {
    const env = await makeEnv();
    (env as { OAUTH_TOKENS?: KVNamespace }).OAUTH_TOKENS = mockKv(); // 空 = 未 bootstrap
    globalThis.fetch = (async (url: string) => jsonRes(url.includes('getRecord') ? 400 : 200, url.includes('getRecord') ? { error: 'RecordNotFound' } : {})) as unknown as typeof fetch;
    await expect(readModifyWrite(env, DID, (c) => c, { now: NOW })).rejects.toMatchObject({ reason: 'not-bootstrapped' });
  });
});

describe('sanitizeGear の手数検証 (#609)', () => {
  const own = (itemId: string, rkey: string): OwnedPiece => ({ rkey, itemId, level: 0 });

  it('片手武器 + 盾は両方通る', () => {
    const out = sanitizeGear(
      { weapon: { id: 'wp-knife', level: 0 }, shield: { id: 'sh-wood', level: 0 } },
      [own('wp-knife', 'a'), own('sh-wood', 'b')],
    );
    expect(out.weapon).toEqual({ id: 'wp-knife', level: 0 });
    expect(out.shield).toEqual({ id: 'sh-wood', level: 0 });
  });

  it('両手武器 + 盾は直 POST でも盾が落ちる (サーバー権威)', () => {
    const out = sanitizeGear(
      { weapon: { id: 'wp-great-sword', level: 0 }, shield: { id: 'sh-wood', level: 0 } },
      [own('wp-great-sword', 'a'), own('sh-wood', 'b')],
    );
    expect(out.weapon).toEqual({ id: 'wp-great-sword', level: 0 });
    expect(out.shield).toBeUndefined();
  });

  it('両手盾 + 武器も盾が落ちる', () => {
    const out = sanitizeGear(
      { weapon: { id: 'wp-knife', level: 0 }, shield: { id: 'sh-tower', level: 0 } },
      [own('wp-knife', 'a'), own('sh-tower', 'b')],
    );
    expect(out.shield).toBeUndefined();
  });

  it('頭・足スロットも所持検証つきで通る', () => {
    const out = sanitizeGear(
      { head: { id: 'hd-leather-hat', level: 1 }, feet: { id: 'ft-cloth-shoes', level: 0 } },
      [own('hd-leather-hat', 'a'), own('ft-cloth-shoes', 'b')],
    );
    // 持っていない強化値 (+1) の頭は落ち、足は通る
    expect(out.head).toBeUndefined();
    expect(out.feet).toEqual({ id: 'ft-cloth-shoes', level: 0 });
  });
});
