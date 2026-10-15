import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { readGuard, createGuard, advanceGuard, deleteGuard, BATTLE_GUARD_COLLECTION, type BattleGuard } from '../src/battle-guard';
import { rkeyForDid } from '../src/game-state';
import { writeServerTokens } from '../src/oauth-store';
import type { ServerPdsEnv } from '../src/server-pds';

const DID = 'did:plc:alice';
const SERVER_DID = 'did:plc:testserver';
const PDS = 'https://pds.example';
const NOW = 1_700_000_000;

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
function mockKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
}
async function makeEnv(): Promise<ServerPdsEnv> {
  const kv = mockKv();
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: PDS, authServer: 'https://bsky.social', updatedAt: NOW });
  return { OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID, WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}

const guard = (turn: number): BattleGuard => ({
  did: DID, battleId: 'btl-1', turn, sealed: { s: 1 }, state: { hp: 10 }, pendingTurnSeed: 0x12345678, rewarded: true,
  expiresAt: '', createdAt: '', updatedAt: '',
});

/** getRecord(public GET) + DPoP putRecord/deleteRecord の swapRecord CAS を実装するモック。 */
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

describe('battle-guard (OAuth 権威書き込み)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('無ければ null / 作成後は読める (rkey は DID ハッシュ・repo はサーバー DID)', async () => {
    const env = await makeEnv();
    const m = guardPds();
    globalThis.fetch = m.fn;
    expect(await readGuard(env, DID)).toBeNull();
    await createGuard(env, NOW, guard(0));
    const r = await readGuard(env, DID);
    expect(r?.guard.battleId).toBe('btl-1');
    expect(m.store.has(rkeyForDid(DID))).toBe(true);
    expect(BATTLE_GUARD_COLLECTION).toBe('app.aozoraquest.battleGuard');
  });

  it('既存があると createGuard は InvalidSwap (二重戦闘を作らせない)', async () => {
    const env = await makeEnv();
    globalThis.fetch = guardPds().fn;
    await createGuard(env, NOW, guard(0));
    await expect(createGuard(env, NOW, guard(0))).rejects.toMatchObject({ xrpcError: 'InvalidSwap' });
  });

  it('advanceGuard は正しい CID でのみ進む / 古い CID は InvalidSwap (やり直し封じ)', async () => {
    const env = await makeEnv();
    globalThis.fetch = guardPds().fn;
    const { cid: c0 } = await createGuard(env, NOW, guard(0));
    const { cid: c1 } = await advanceGuard(env, NOW, guard(1), c0);
    expect(c1).not.toBe(c0);
    await expect(advanceGuard(env, NOW, guard(1), c0)).rejects.toMatchObject({ xrpcError: 'InvalidSwap' });
    await expect(advanceGuard(env, NOW, guard(2), c1)).resolves.toBeTruthy();
  });

  it('deleteGuard は CID 一致で削除 / 不一致は InvalidSwap', async () => {
    const env = await makeEnv();
    globalThis.fetch = guardPds().fn;
    const { cid } = await createGuard(env, NOW, guard(0));
    await expect(deleteGuard(env, NOW, DID, 'wrong')).rejects.toMatchObject({ xrpcError: 'InvalidSwap' });
    await deleteGuard(env, NOW, DID, cid);
    expect(await readGuard(env, DID)).toBeNull();
  });
});
