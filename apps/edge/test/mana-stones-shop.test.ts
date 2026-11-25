/**
 * 魔石で払う店 (D-MATERIAL-001)。プレイヤーに見える振る舞い:
 * - 属性つきの装備は、値札の 3 分の 1 (切り上げ) をその属性の魔石、残りを町の魔石で払う。町のテーマと同じ属性なら全部その魔石。
 * - 町の「魔石の交換」は、その町の魔石だけで買える (パワーは減らない)。並んでいない品・ほかの魔石では買えない。
 * - 魔石になる前の素材は、読んだときに持ち物から消える (名前の壊れた品として出さない)。
 * - 町のある地方の遭遇は、町のテーマの属性の敵が「よく出る敵」。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { EQUIPMENT, ITEMS, favoredMonsterFor, regionFavorAffinity, setItemOverrides, setShopOverrides, startBattle, tierForRegion, townShopStock, worldOverlay, type EquipmentDef } from '@aozoraquest/core';
import { shopCraft } from '../src/shop';
import { shopExchange } from '../src/shop-exchange';
import { normalizeState, rkeyForDid, XP_EPOCH, type GameState, type GameStateEnv } from '../src/game-state';
import { writeServerTokens } from '../src/oauth-store';

const DID = 'did:plc:stones';
const SERVER_DID = 'did:plc:testserver';
const NOW = 1_700_000_000;

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
async function makeEnv(): Promise<GameStateEnv> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: 'https://pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { SERVER_DID, OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}
function statefulPds(seed: GameState) {
  const store = new Map<string, { value: unknown; cid: string }>([[rkeyForDid(DID), { value: seed, cid: 'c0' }]]);
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('com.atproto.repo.getRecord')) {
      const rec = store.get(new URL(url).searchParams.get('rkey')!);
      return rec ? json(200, { uri: 'at://x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    if (url.includes('com.atproto.repo.putRecord')) {
      const b = JSON.parse(init.body as string) as { rkey: string; record: unknown };
      store.set(b.rkey, { value: b.record, cid: `cid${++n}` });
      return json(200, { uri: 'at://x', cid: `cid${n}` });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
  return { fn, store };
}

const TOWN = worldOverlay().towns[0]!;
const FIRE_SWORD: EquipmentDef = { id: 'wp-fire-test', name: 'ほのおの けん', slot: 'weapon', kind: 'common', bonus: { atk: 5 }, grade: 1, price: { power: 5, materials: 9 }, element: 'fire' };
const PLAIN: EquipmentDef = { id: 'wp-plain-test', name: 'ぼう', slot: 'weapon', kind: 'common', bonus: { atk: 3 }, grade: 1, price: { power: 5, materials: 6 } };
const stateAt = (materials: Record<string, number>, over: Partial<GameState> = {}): GameState => ({
  did: DID, activeQuests: [], power: 100, playerXp: 0, jobXp: {}, materials, gear: [], x: TOWN.x, y: TOWN.y, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over,
});
const setup = (theme: 'water' | 'fire') => {
  setItemOverrides({ items: Object.entries(ITEMS).map(([id, v]) => ({ id, ...v })), equipment: [...EQUIPMENT, FIRE_SWORD, PLAIN] });
  setShopOverrides([{ x: TOWN.x, y: TOWN.y, theme, equipment: [FIRE_SWORD.id, PLAIN.id], exchange: [{ itemId: 'herb', stones: 4 }] }]);
};

describe('魔石で払う店 (D-MATERIAL-001)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; setShopOverrides(null); setItemOverrides(null); });

  it('水の町で火の装備 (魔石 9): 火 3 + 水 6 を払う', async () => {
    setup('water');
    const m = statefulPds(stateAt({ 'stone-fire': 5, 'stone-water': 10 }));
    globalThis.fetch = m.fn;
    const r = await shopCraft(await makeEnv(), DID, { itemId: FIRE_SWORD.id, rkey: 'c1', luk: 0 }, NOW);
    expect(r.materials).toEqual({ 'stone-fire': 2, 'stone-water': 4 });
    expect(r.power).toBe(95);
  });

  it('火の魔石が足りなければ、水が多くても作れない', async () => {
    setup('water');
    globalThis.fetch = statefulPds(stateAt({ 'stone-fire': 2, 'stone-water': 30 })).fn;
    await expect(shopCraft(await makeEnv(), DID, { itemId: FIRE_SWORD.id, rkey: 'c2', luk: 0 }, NOW)).rejects.toMatchObject({ code: 'no_material' });
  });

  it('火の町では火の装備は全部火の魔石。属性の無い品は町の魔石', async () => {
    setup('fire');
    const m = statefulPds(stateAt({ 'stone-fire': 20 }));
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    expect((await shopCraft(env, DID, { itemId: FIRE_SWORD.id, rkey: 'c3', luk: 0 }, NOW)).materials).toEqual({ 'stone-fire': 11 });
    expect((await shopCraft(env, DID, { itemId: PLAIN.id, rkey: 'c4', luk: 0 }, NOW)).materials).toEqual({ 'stone-fire': 5 });
  });

  it('魔石の交換: 町の魔石だけで買えて、パワーは減らない。並んでいない品は買えない', async () => {
    setup('water');
    const m = statefulPds(stateAt({ 'stone-water': 5 }));
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    const r = await shopExchange(env, DID, { id: 'herb', rkey: 'x1' }, NOW);
    expect(r.materials).toEqual({ 'stone-water': 1, herb: 1 });
    expect(r.power).toBe(100);
    await expect(shopExchange(env, DID, { id: 'sky-dew', rkey: 'x2' }, NOW)).rejects.toMatchObject({ code: 'not_in_stock' });
    await expect(shopExchange(env, DID, { id: 'herb', rkey: 'x3' }, NOW)).rejects.toMatchObject({ code: 'no_material' });
    expect((await shopExchange(env, DID, { id: 'herb', rkey: 'x1' }, NOW)).duplicate).toBe(true); // 同じ rkey は 1 回だけ
  });

  it('ほかの属性の魔石では交換できない', async () => {
    setup('water');
    globalThis.fetch = statefulPds(stateAt({ 'stone-fire': 50 })).fn;
    await expect(shopExchange(await makeEnv(), DID, { id: 'herb', rkey: 'x4' }, NOW)).rejects.toMatchObject({ code: 'no_material' });
  });
});

describe('旧素材と、町のテーマの遭遇', () => {
  afterEach(() => setShopOverrides(null));

  it('魔石になる前の素材は、読んだときに持ち物から消える。ほかの品は残る', () => {
    const s = normalizeState(stateAt({ 'slime-drop': 4, 'bat-wing': 1, herb: 2, 'stone-water': 3 }));
    expect(s.materials).toEqual({ herb: 2, 'stone-water': 3 });
  });

  it('町のテーマを決めると、その地方の「よく出る敵」はテーマの属性の敵になる', () => {
    const tier = tierForRegion(TOWN.region);
    setShopOverrides([{ x: TOWN.x, y: TOWN.y, theme: 'earth' }]);
    const fav = favoredMonsterFor(tier, regionFavorAffinity(tier, TOWN.region))!;
    expect(fav.element).toBe('earth');
    expect(townShopStock(TOWN, 0).materialId).toBe('stone-earth');
    // 遭遇もこの値で引く (多く出る)
    let hits = 0;
    for (let seed = 1; seed <= 200; seed++) if (startBattle('warrior', 1, 1, 't', tier, seed, 0, undefined, { affinity: regionFavorAffinity(tier, TOWN.region) }).monsterId === fav.id) hits++;
    expect(hits).toBeGreaterThan(40);
  });
});
