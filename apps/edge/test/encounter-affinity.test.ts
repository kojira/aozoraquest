import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { favoredMonsterFor, regionAffinity, regionOf, startBattle, tierForRegion, worldOverlay, wrap } from '@aozoraquest/core';
import { sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { writeServerTokens } from '../src/oauth-store';
import { XP_EPOCH, type GameState } from '../src/game-state';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';

// 地域の相性 (docs/19。×3 で出やすくする) をサーバーの遭遇で使う (#1022)。
// 画面の上枠「よく出る敵」は favoredMonsterFor(tier, regionAffinity(region)) を出しているので、遭遇も同じ値で引く。
const USER = 'did:plc:affinity';
const SERVER_DID = 'did:plc:testserver';
const NOW = 1_700_000_000;

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
async function makeEnv(): Promise<ResolverEnv> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: 'https://server-pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID, WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}
const GS: GameState = { did: USER, activeQuests: [], power: 5, playerXp: 100, jobXp: { warrior: 50 }, materials: {}, gear: [], x: 0, y: 0, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };

/** 診断を返し、ガードの作成を受ける最小の PDS。 */
const pdsFetch = (async (url: string) => {
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  if (url.includes('plc.directory')) return json(200, { id: USER, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://user-pds.example' }] });
  if (url.includes('getRecord')) {
    const col = new URL(url).searchParams.get('collection');
    return col === 'app.aozoraquest.analysis' ? json(200, { uri: 'x', cid: 'd', value: { archetype: 'warrior', rpgStats: { atk: 30, def: 25, agi: 15, int: 15, luk: 15 } } }) : json(400, { error: 'RecordNotFound' });
  }
  return json(200, { uri: 'x', cid: 'c1' });
}) as unknown as typeof fetch;

describe('サーバーの遭遇と地域の相性 (#1022)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('フィールドの遭遇は regionAffinity で選ぶ: 画面の「よく出る敵」が実際に多く出て、同じ seed なら同じ敵', async () => {
    const env = await makeEnv();
    globalThis.fetch = pdsFetch;
    const c = worldOverlay().spawn;
    const x = wrap(c.x + 20), y = c.y; // ふたばの 8 マスの外
    const region = regionOf(x, y);
    const tier = tierForRegion(region);
    const favored = favoredMonsterFor(tier, regionAffinity(region))!.id;
    let hits = 0;
    const N = 60;
    for (let seed = 1; seed <= N; seed++) {
      const r = await sealEncounter(env, USER, GS, x, y, seed, NOW);
      expect(r.monsterId).toBe(startBattle('warrior', 1, 1, 'test', tier, seed, 0, undefined, { affinity: regionAffinity(region) }).monsterId);
      expect((await sealEncounter(env, USER, GS, x, y, seed, NOW)).monsterId).toBe(r.monsterId);
      if (r.monsterId === favored) hits++;
    }
    // 相性なしなら 1/プール数。×3 の重みで、それよりはっきり多い。
    const pool = TEST_MONSTERS.filter((m) => m.tier === tier && !m.storyOnly).length;
    expect(hits / N).toBeGreaterThan(1.5 / pool);
  });
});
