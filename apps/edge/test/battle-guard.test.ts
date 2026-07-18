import { describe, it, expect, afterEach } from 'vitest';
import { readGuard, createGuard, advanceGuard, deleteGuard, BATTLE_GUARD_COLLECTION, type BattleGuard } from '../src/battle-guard';
import { rkeyForDid } from '../src/game-state';
import type { PdsSession } from '../src/pds';

const session: PdsSession = { pdsUrl: 'https://pds.example', accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:server' };
const DID = 'did:plc:alice';
const NOW = '2026-07-19T00:00:00.000Z';

const guard = (turn: number): BattleGuard => ({
  did: DID, battleId: 'btl-1', turn, sealed: { s: 1 }, state: { hp: 10 }, pendingTurnSeed: 0x12345678, rewarded: true,
  expiresAt: NOW, createdAt: NOW, updatedAt: NOW,
});

/** バトルガードのステートフル PDS モック (put/get/delete の swapRecord CAS を実装)。 */
function guardPds() {
  const store = new Map<string, { value: unknown; cid: string }>();
  let counter = 0;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('getRecord')) {
      const rk = new URL(url).searchParams.get('rkey')!;
      const rec = store.get(rk);
      return rec ? json(200, { uri: 'x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    const b = JSON.parse(init.body as string) as { rkey: string; record?: unknown; swapRecord?: string | null };
    const cur = store.get(b.rkey);
    if (url.includes('putRecord')) {
      if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      const cid = `cid${++counter}`;
      store.set(b.rkey, { value: b.record, cid });
      return json(200, { uri: 'x', cid });
    }
    if (url.includes('deleteRecord')) {
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      store.delete(b.rkey);
      return json(200, {});
    }
    return json(404, { error: 'nf' });
  }) as unknown as typeof fetch;
  return { fn, store };
}

describe('battle-guard', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('無ければ null / 作成後は読める (rkey は DID ハッシュ)', async () => {
    const m = guardPds();
    globalThis.fetch = m.fn;
    expect(await readGuard(session, DID)).toBeNull();
    await createGuard(session, guard(0));
    const r = await readGuard(session, DID);
    expect(r?.guard.battleId).toBe('btl-1');
    expect(m.store.has(rkeyForDid(DID))).toBe(true);
    expect(BATTLE_GUARD_COLLECTION).toBe('app.aozoraquest.battleGuard');
  });

  it('既存があると createGuard は InvalidSwap (二重戦闘を作らせない)', async () => {
    const m = guardPds();
    globalThis.fetch = m.fn;
    await createGuard(session, guard(0));
    await expect(createGuard(session, guard(0))).rejects.toMatchObject({ xrpcError: 'InvalidSwap' });
  });

  it('advanceGuard は正しい CID でのみ進む / 古い CID は InvalidSwap (やり直し封じ)', async () => {
    const m = guardPds();
    globalThis.fetch = m.fn;
    const { cid: c0 } = await createGuard(session, guard(0));
    const { cid: c1 } = await advanceGuard(session, guard(1), c0);
    expect(c1).not.toBe(c0);
    // 同じターンを古い CID で引き直そうとすると弾かれる
    await expect(advanceGuard(session, guard(1), c0)).rejects.toMatchObject({ xrpcError: 'InvalidSwap' });
    // 正しい CID なら進める
    await expect(advanceGuard(session, guard(2), c1)).resolves.toBeTruthy();
  });

  it('deleteGuard は CID 一致で削除 / 不一致は InvalidSwap', async () => {
    const m = guardPds();
    globalThis.fetch = m.fn;
    const { cid } = await createGuard(session, guard(0));
    await expect(deleteGuard(session, DID, 'wrong')).rejects.toMatchObject({ xrpcError: 'InvalidSwap' });
    await deleteGuard(session, DID, cid);
    expect(await readGuard(session, DID)).toBeNull();
  });
});
