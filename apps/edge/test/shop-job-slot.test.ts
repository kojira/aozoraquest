import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { ARCHETYPES, EQUIPMENT, TIER_LEVEL, activeItems, setItemOverrides, setMonsterOverrides, tierForRegion, townShopStock, worldOverlay, type EquipmentDef, type MonsterDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { shopCraft } from '../src/shop';
import { rkeyForDid, XP_EPOCH, type GameState, type GameStateEnv } from '../src/game-state';
import { writeServerTokens } from '../src/oauth-store';

/** D-ENDGAME-001 PR2: tier4 以上の店では、自分のジョブの専用品を作ってもらえる (ほかの職の品は扱っていない)。 */
const DID = 'did:plc:alice';
const NOW = 1_700_000_000;
function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
async function makeEnv(): Promise<GameStateEnv> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: 'did:plc:testserver', accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: 'https://pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { SERVER_DID: 'did:plc:testserver', OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}
function pds(seed: GameState) {
  const store = new Map<string, { value: unknown; cid: string }>([[rkeyForDid(DID), { value: seed, cid: 'c0' }]]);
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return (async (url: string, init: RequestInit = {}) => {
    if (url.includes('getRecord')) { const rec = store.get(new URL(url).searchParams.get('rkey')!); return rec ? json(200, { uri: 'at://x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' }); }
    if (url.includes('putRecord')) { const b = JSON.parse(init.body as string) as { rkey: string; record: unknown }; store.set(b.rkey, { value: b.record, cid: `c${++n}` }); return json(200, { uri: 'at://x', cid: `c${n}` }); }
    return json(404, {});
  }) as unknown as typeof fetch;
}

describe('shopCraft: tier4 以上の店の自分のジョブの枠', () => {
  const orig = globalThis.fetch;
  const BASE = EQUIPMENT.map((e) => ({ ...e }));
  afterEach(() => { globalThis.fetch = orig; setMonsterOverrides(TEST_MONSTERS); setItemOverrides(null); });

  it('自分の職の専用品は作れて、ほかの職の専用品は not_in_stock', async () => {
    const extra: MonsterDef[] = [4, 5, 6].flatMap((tier) => [0, 1, 2].map((i) => ({ id: `d${tier}${i}`, name: `d${tier}${i}`, species: 'slime', tint: `#00${tier}${i}00`, level: TIER_LEVEL[tier as 4], tier: tier as 4, stats: [40, 30, 20, 10, 10] as [number, number, number, number, number], hp: 30, xp: 70, drops: [], intro: 'て。' })));
    setMonsterOverrides([...TEST_MONSTERS, ...extra]);
    const jobGear: EquipmentDef[] = ARCHETYPES.flatMap((job) => [4, 5, 6].map((g) => ({ id: `wp-${job}-g${g}`, name: `${job}${g}`, slot: 'weapon' as const, kind: 'exclusive' as const, jobOnly: job, grade: g as 4, bonus: { atk: 1 }, price: { power: 1, materials: 0 } })));
    setItemOverrides({ items: activeItems(), equipment: [...BASE, ...jobGear] });
    const towns = worldOverlay().towns;
    const i = towns.findIndex((t) => tierForRegion(t.region) === 4);
    const town = towns[i]!;
    const stock = townShopStock(town, i);
    const state: GameState = { did: DID, activeQuests: [], power: 999, playerXp: 0, jobXp: {}, materials: { [stock.materialId]: 99 }, gear: [], x: town.x, y: town.y, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
    globalThis.fetch = pds(state);
    const env = await makeEnv();
    const ok = await shopCraft(env, DID, { itemId: 'wp-sage-g4', rkey: 'r1', luk: 0, archetype: 'sage' }, NOW);
    expect((ok.pieces ?? []).map((p) => p.itemId)).toContain('wp-sage-g4');
    await expect(shopCraft(env, DID, { itemId: 'wp-mage-g4', rkey: 'r2', luk: 0, archetype: 'sage' }, NOW)).rejects.toMatchObject({ code: 'not_in_stock' });
    // 職を渡さない (古い呼び出し) ときは枠が無い
    await expect(shopCraft(env, DID, { itemId: 'wp-sage-g4', rkey: 'r3', luk: 0 }, NOW)).rejects.toMatchObject({ code: 'not_in_stock' });
  });
});
