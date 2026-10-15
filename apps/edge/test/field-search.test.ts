/**
 * しらべるの置きアイテム (D-STORY-009 M2)。守るべき不変条件:
 *   - パワー 0 でも 1 回だけ取れる (取った flag で二度目は普段のしらべる)
 *   - 位置は署名済みトークンが正 (別マスのトークンでは取れない)
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { setStory, WORLD_MAP_ID } from '@aozoraquest/core';
import { handleSearch } from '../src/field-search';
import { ResolverError, type ResolverEnv } from '../src/battle-resolver';
import { signPosition } from '../src/world-token';
import { rkeyForDid, XP_EPOCH, type GameState } from '../src/game-state';
import { writeServerTokens } from '../src/oauth-store';

const DID = 'did:plc:alice';
const NOW = 1_700_000_000;
const SPOT = { mapId: 'cave-1', x: 4, y: 7 };

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
async function makeEnv(): Promise<ResolverEnv> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: 'did:plc:server', accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: 'https://server-pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID: 'did:plc:server', WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}
/** 診断 (analysis) + 権威 state の CAS を持つ PDS モック。 */
function pds(seed: GameState) {
  const store = new Map<string, { value: unknown; cid: string }>([[rkeyForDid(DID), { value: seed, cid: 'c0' }]]);
  let n = 0;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('plc.directory')) return json(200, { id: DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://user-pds.example' }] });
    if (url.includes('getRecord')) {
      const u = new URL(url);
      if (u.searchParams.get('collection')!.endsWith('.analysis')) return json(200, { uri: 'x', cid: 'd', value: { archetype: 'warrior', rpgStats: { atk: 30, def: 25, agi: 15, int: 15, luk: 15 } } });
      const rec = store.get(u.searchParams.get('rkey')!);
      return rec ? json(200, { uri: 'x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    if (url.includes('putRecord')) {
      const b = JSON.parse(init.body as string) as { rkey: string; record: unknown; swapRecord?: string | null };
      const cur = store.get(b.rkey);
      if (typeof b.swapRecord === 'string' && cur?.cid !== b.swapRecord) return json(400, { error: 'InvalidSwap' });
      store.set(b.rkey, { value: b.record, cid: `c${++n}` });
      return json(200, { uri: 'x', cid: `c${n}` });
    }
    return json(404, { error: 'nf' });
  }) as unknown as typeof fetch;
  return { fn, state: () => store.get(rkeyForDid(DID))!.value as GameState };
}
const GS = (over: Partial<GameState> = {}): GameState => ({ did: DID, activeQuests: [], power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 0, y: 0, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over });

describe('handleSearch の置きアイテム (D-STORY-009)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });
  beforeAll(() => setStory({ placedItems: [{ id: 'pi-key', ...SPOT, itemId: 'herb', count: 2, flag: 'got-old-key', requireFlags: ['heard-key'] }] }));
  afterAll(() => setStory(null));

  it('パワー 0 でも 1 回だけ取れる。2 回目は普段のしらべる (パワー不足で 400)', async () => {
    const env = await makeEnv();
    const m = pds(GS({ flags: ['heard-key'] }));
    globalThis.fetch = m.fn;
    const token = signPosition(env, { did: DID, ...SPOT, counter: 1, iat: NOW });
    const res = await handleSearch(env, DID, token, NOW, undefined, undefined, 'k1');
    expect(res.placed).toEqual({ itemId: 'herb', count: 2 });
    expect(res.power).toBe(0);
    expect(res.flags).toContain('got-old-key');
    expect(m.state().materials.herb).toBe(2);
    // 同じ鍵の再送は二重に付与しない
    expect((await handleSearch(env, DID, token, NOW, undefined, undefined, 'k1')).placed).toBeDefined();
    expect(m.state().materials.herb).toBe(2);
    await expect(handleSearch(env, DID, token, NOW, undefined, undefined, 'k2')).rejects.toMatchObject({ code: 'no_power' });
    expect(m.state().materials.herb).toBe(2);
  });

  it('条件のフラグが無い / 別マスのトークンでは取れない (普段のしらべる)', async () => {
    const env = await makeEnv();
    const m = pds(GS({ flags: [] }));
    globalThis.fetch = m.fn;
    await expect(handleSearch(env, DID, signPosition(env, { did: DID, ...SPOT, counter: 1, iat: NOW }), NOW)).rejects.toThrow(ResolverError);
    const m2 = pds(GS({ flags: ['heard-key'], mapId: SPOT.mapId, x: SPOT.x, y: SPOT.y }));
    globalThis.fetch = m2.fn;
    await expect(handleSearch(env, DID, signPosition(env, { did: DID, mapId: SPOT.mapId, x: SPOT.x + 1, y: SPOT.y, counter: 1, iat: NOW }), NOW)).rejects.toMatchObject({ code: 'no_power' });
    await expect(handleSearch(env, DID, signPosition(env, { did: DID, mapId: WORLD_MAP_ID, x: SPOT.x, y: SPOT.y, counter: 1, iat: NOW }), NOW)).rejects.toMatchObject({ code: 'no_power' });
    expect(m2.state().flags).not.toContain('got-old-key');
  });
});
