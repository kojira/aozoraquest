/**
 * 手編集ワールドの読み込み (edge 側) — レコードの**有無**で適用を決める (#660)。
 *
 * 守るべき不変条件:
 *   - レコードが**存在すれば空配列でも適用する** (全削除の保存は {npcs: []} になる。
 *     length で弾くと warm isolate に削除済みのものが残り続ける)
 *   - レコードが**無ければ触らない** (読めない日にメモリの定義を消さない)
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { activeMonsters, clearMonsters, clearMonsterArts, monsterArtSvg, encodeMonstersForRecord, setMonsterOverrides, type MonsterDef, BASE_PARTS, BIOME_PARTS, encodeWorldMap, setWorldMap, setInteriors, interiorById, interiorTerrainAt, interiorWalkableAt, terrainAt, isWalkableAt, worldParts, allNpcs, setNpcs, setShopOverrides, shopOverrides, type NpcDef, type ShopOverride } from '@aozoraquest/core';
import { ensureAuthoredWorld, resetAuthoredWorldCache } from '../src/world-authoring';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';

const DID = 'did:plc:admin';
const PDS = 'https://pds.test';
const NSID = 'app.aozoraquest';
const NOW = 1_700_000_000;

const NPC: NpcDef = { id: 'elder', name: '長老', x: 3, y: 4, lines: ['やあ'] };
const SHOP: ShopOverride = { x: 10, y: 20, consumables: [] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 管理者 PDS のふり。`records` に無いコレクションは RecordNotFound。 */
function fakePds(records: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://plc.directory/')) {
      return json(200, { id: DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] });
    }
    if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.getRecord?`)) {
      const col = new URL(url).searchParams.get('collection') ?? '';
      const key = col.slice(`${NSID}.world.`.length);
      if (key in records) return json(200, { uri: `at://${DID}/${col}/self`, cid: 'cid1', value: records[key] });
      return json(400, { error: 'RecordNotFound', message: 'Could not locate record' });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
}

describe('ensureAuthoredWorld: 空配列のレコードを適用する (#660)', () => {
  const orig = globalThis.fetch;
  const env = { ADMIN_DIDS: DID };

  beforeEach(() => {
    resetAuthoredWorldCache();
    setNpcs([NPC]);
    setShopOverrides([SHOP]);
  });
  afterEach(() => {
    globalThis.fetch = orig;
    resetAuthoredWorldCache();
    setNpcs(null);
    setShopOverrides(null);
  });

  it('new biome records decode as authoritative terrain without reindexing existing parts', async () => {
    const parts = [...BASE_PARTS, { terrain: 'bridge', name: '既存の橋' }, ...BIOME_PARTS];
    const tiles = new Uint8Array(16); tiles.set([8, 9, 10, 11]);
    const gz = Buffer.from(await encodeWorldMap(tiles)).toString('base64');
    globalThis.fetch = fakePds({ map: { size: 4, parts, gz },
      interiors: { interiors: [{ id: 'biomes', name: '雪と砂', size: 4, parts, gz }], gates: [] } });
    try {
      await ensureAuthoredWorld(env, NOW);
      expect(worldParts()).toEqual(parts);
      expect([0, 1, 2, 3].map(x => terrainAt(x, 0))).toEqual(['bridge', 'snowfield', 'snowMountain', 'desert']);
      expect([1, 2, 3].map(x => isWalkableAt(x, 0))).toEqual([true, false, true]);
      const map = interiorById('biomes')!;
      expect([1, 2, 3].map(x => interiorTerrainAt(map, x, 0))).toEqual(['snowfield', 'snowMountain', 'desert']);
      expect([1, 2, 3].map(x => interiorWalkableAt(map, x, 0))).toEqual([true, false, true]);
    } finally { setWorldMap(null); setInteriors([], []); }
  });

  it('loads the Bluesky preset alongside unchanged legacy NPCs', async () => {
    const npcs: NpcDef[] = [NPC, { ...NPC, id: 'sky', x: 5, spritePreset: 'bluesky' }];
    globalThis.fetch = fakePds({ npcs: { npcs } });
    await ensureAuthoredWorld(env, NOW);
    expect(allNpcs()).toEqual(npcs);
  });

  it('NPC: {npcs: []} で全 NPC が消える', async () => {
    globalThis.fetch = fakePds({ npcs: { npcs: [] } });
    await ensureAuthoredWorld(env, NOW);
    expect(allNpcs()).toEqual([]);
  });

  it('NPC: レコードが無ければメモリの NPC を保持する', async () => {
    globalThis.fetch = fakePds({});
    await ensureAuthoredWorld(env, NOW);
    expect(allNpcs().map((n) => n.id)).toEqual(['elder']);
  });

  it('店: {shops: []} で全上書きが外れる', async () => {
    globalThis.fetch = fakePds({ shops: { shops: [] } });
    await ensureAuthoredWorld(env, NOW);
    expect(shopOverrides()).toEqual([]);
  });

  it('店: レコードが無ければメモリの上書きを保持する', async () => {
    globalThis.fetch = fakePds({});
    await ensureAuthoredWorld(env, NOW);
    expect(shopOverrides().map((s) => [s.x, s.y])).toEqual([[10, 20]]);
  });
});

describe('ensureAuthoredWorld: monsters の KV last-good (D-MONSTER-001)', () => {
  const orig = globalThis.fetch;
  const KEY = `admin-world:${NSID}:monsters`;
  const CACHED: MonsterDef[] = [...TEST_MONSTERS, { ...TEST_MONSTERS[0]!, id: 'golden-lantern', name: 'こがねランタン', storyOnly: true }];
  const record = (list: readonly MonsterDef[]) => ({ monsters: encodeMonstersForRecord([...list]), updatedAt: 'x' });

  function stubKv(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const puts: string[] = [];
    const kv = {
      get: async (k: string, type?: string) => { const v = data.get(k) ?? null; return v !== null && type === 'json' ? JSON.parse(v) : v; },
      put: async (k: string, v: string) => { puts.push(k); data.set(k, v); },
      delete: async (k: string) => { data.delete(k); },
    } as unknown as KVNamespace;
    return { kv, data, puts };
  }

  /** monsters の cid を差し替えられる管理者 PDS。 */
  function pdsWithMonsters(value: unknown, cid: () => string): typeof fetch {
    const base = fakePds({});
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('collection=app.aozoraquest.world.monsters')) return json(200, { uri: 'at://x', cid: cid(), value });
      return base(input, init);
    }) as unknown as typeof fetch;
  }

  beforeEach(() => { resetAuthoredWorldCache(); clearMonsters(); });
  afterEach(() => { globalThis.fetch = orig; resetAuthoredWorldCache(); setMonsterOverrides(TEST_MONSTERS); });

  const unresolved: Array<[string, Record<string, string | undefined>, () => typeof fetch]> = [
    ['resolveDidDocument が reject', { ADMIN_DIDS: 'did:plc:unresolvable' }, () => (async () => { throw new Error('plc down'); }) as unknown as typeof fetch],
    ['ADMIN_DIDS が未設定', {}, () => fakePds({})],
    ['PDS の endpoint が無い', { ADMIN_DIDS: 'did:plc:nopds' }, () => (async () => json(200, { id: 'did:plc:nopds', service: [] })) as unknown as typeof fetch],
  ];
  for (const [label, envVars, fetchImpl] of unresolved) {
    it(`${label} でも KV の 21 体が入る`, async () => {
      const { kv, puts } = stubKv({ [KEY]: JSON.stringify({ cid: 'cid-kv', value: record(CACHED) }) });
      globalThis.fetch = fetchImpl();
      await ensureAuthoredWorld({ ...envVars, OAUTH_TOKENS: kv }, NOW);
      expect(activeMonsters().map((m) => m.id)).toEqual(CACHED.map((m) => m.id));
      expect(puts).toEqual([]);
    });
  }

  it('PDS の cid が同じなら、TTL ごとの読み直しで put しない。cid が変わったら 1 回だけ put する', async () => {
    const { kv, data, puts } = stubKv();
    let cid = 'cid-a';
    globalThis.fetch = pdsWithMonsters(record(TEST_MONSTERS), () => cid);
    const env = { ADMIN_DIDS: DID, OAUTH_TOKENS: kv };
    await ensureAuthoredWorld(env, NOW);
    expect(puts).toEqual([KEY]);
    expect(JSON.parse(data.get(KEY)!).cid).toBe('cid-a');
    await ensureAuthoredWorld(env, NOW + 301);
    await ensureAuthoredWorld(env, NOW + 602);
    expect(puts).toHaveLength(1);
    cid = 'cid-b';
    await ensureAuthoredWorld(env, NOW + 903);
    expect(puts).toHaveLength(2);
    expect(JSON.parse(data.get(KEY)!).cid).toBe('cid-b');
    expect(activeMonsters()).toHaveLength(TEST_MONSTERS.length);
  });

  it('cold isolate: KV に同じ cid があれば put しない (最初に 1 回だけ KV の cid を読む)', async () => {
    const { kv, puts } = stubKv({ [KEY]: JSON.stringify({ cid: 'cid-a', value: record(TEST_MONSTERS) }) });
    globalThis.fetch = pdsWithMonsters(record(TEST_MONSTERS), () => 'cid-a');
    await ensureAuthoredWorld({ ADMIN_DIDS: DID, OAUTH_TOKENS: kv }, NOW);
    expect(puts).toEqual([]);
  });

  it('monsterArt も KV に last-good を置き、PDS が読めないときは KV の絵が入る (PR2)', async () => {
    const ART_KEY = `admin-world:${NSID}:monsterArt`;
    const art = { arts: [{ id: 'slime', svg: '<g fill="{{tint|#57b7ee}}"/>' }], updatedAt: 'x' };
    const { kv, data, puts } = stubKv();
    const base = pdsWithMonsters(record(TEST_MONSTERS), () => 'cid-m');
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('collection=app.aozoraquest.world.monsterArt')) return json(200, { uri: 'at://x', cid: 'cid-art', value: art });
      return base(input, init);
    }) as unknown as typeof fetch;
    await ensureAuthoredWorld({ ADMIN_DIDS: DID, OAUTH_TOKENS: kv }, NOW);
    expect(puts).toContain(ART_KEY);
    expect(JSON.parse(data.get(ART_KEY)!)).toEqual({ cid: 'cid-art', value: art });
    clearMonsterArts();
    resetAuthoredWorldCache();
    globalThis.fetch = (async () => { throw new Error('plc down'); }) as unknown as typeof fetch;
    await ensureAuthoredWorld({ ADMIN_DIDS: 'did:plc:unresolvable', OAUTH_TOKENS: kv }, NOW);
    expect(monsterArtSvg('slime', undefined)).toContain('#57b7ee');
    clearMonsterArts();
  });

  it('PDS の monsters が空なら KV で上書きせず、KV の値を使う', async () => {
    const { kv, data, puts } = stubKv({ [KEY]: JSON.stringify({ cid: 'cid-kv', value: record(CACHED) }) });
    globalThis.fetch = pdsWithMonsters({ monsters: [], updatedAt: 'x' }, () => 'cid-empty');
    await ensureAuthoredWorld({ ADMIN_DIDS: DID, OAUTH_TOKENS: kv }, NOW);
    expect(puts).toEqual([]);
    expect(JSON.parse(data.get(KEY)!).cid).toBe('cid-kv');
    expect(activeMonsters()).toHaveLength(CACHED.length);
  });
});
