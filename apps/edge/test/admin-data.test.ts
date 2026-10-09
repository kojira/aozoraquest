/**
 * dev 専用の管理データ API (#695)。docs/issue-695-admin-data-api.md が正本。
 *
 * 守るべき不変条件:
 *   - 無効・鍵なし・鍵違い・対象外 name は通常の not_found と同じ 404 (存在を明かさない)
 *   - PUT は管理画面と同じ検証を通し、壊れていれば書かない (400)
 *   - dryRun は書かない / swapCid が古ければ 409 / 成功時は swapRecord 付きで putRecord
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { activeEquipment, activeMonsters, clearMonsters, encodeWorldMap, ITEMS, MONSTERS_BY_ID, setInteriors, setItemOverrides, setMonsterOverrides, setNpcs, setScenario, setStory, setWorldMap, worldOverlay, WORLD_SIZE, type NpcDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleRequest, type Env } from '../src/router';
import { writeServerTokens } from '../src/oauth-store';
import { resetAuthoredWorldCache } from '../src/world-authoring';

const ADMIN = 'did:plc:admin';
const PDS = 'https://pds.example';
const KEY = 'test-admin-data-key';
const COL = (name: string) => `app.aozoraquest.world.${name}`;
/** 地図の (x, y) = (200, 200) を水 (歩けない) にする。他は平原。 */
const WATER = { x: 200, y: 200 };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill), pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
async function makeEnv(extra: Partial<Env> = {}): Promise<Env> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: ADMIN, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: Math.floor(Date.now() / 1000) + 3600, pdsUrl: PDS, authServer: 'https://bsky.social', updatedAt: 0 });
  return { SERVER_DID: ADMIN, ADMIN_DIDS: ADMIN, OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), WORKER_DID: 'did:web:edge.aozoraquest.app',
    OAUTH_TOKENS: kv, ADMIN_DATA_API_ENABLED: '1', ADMIN_DATA_API_KEY: KEY, ...extra };
}

/** 管理者 PDS のふり。collection 単位で { value, cid } を持ち、putRecord は swapRecord を CAS で見る。 */
function fakePds(store: Map<string, { value: unknown; cid: string }>) {
  const puts: Array<{ collection: string; record: Record<string, unknown>; swapRecord?: string | null }> = [];
  let counter = 0;
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://plc.directory/')) {
      return json(200, { id: ADMIN, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] });
    }
    if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.getRecord?`)) {
      const rec = store.get(new URL(url).searchParams.get('collection') ?? '');
      return rec ? json(200, { uri: 'at://x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.putRecord`)) {
      const b = JSON.parse(init.body as string) as { collection: string; record: Record<string, unknown>; swapRecord?: string | null };
      const cur = store.get(b.collection);
      if ((b.swapRecord === null && cur) || (typeof b.swapRecord === 'string' && cur?.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      puts.push(b);
      store.set(b.collection, { value: b.record, cid: `new${++counter}` });
      return json(200, { uri: 'at://x', cid: `new${counter}` });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
  return { fn, puts };
}

const NPC: NpcDef = { id: 'elder', name: '長老', x: 300, y: 300, lines: ['やあ'] };
function call(method: string, name: string, opts: { key?: string | null; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.key !== null) headers.authorization = `Bearer ${opts.key ?? KEY}`;
  return new Request(`https://edge.test/api/admin/data/${name}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
}

describe('/api/admin/data (#695)', () => {
  const orig = globalThis.fetch;
  let store: Map<string, { value: unknown; cid: string }>;
  let pds: ReturnType<typeof fakePds>;
  beforeEach(async () => {
    const tiles = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
    tiles[WATER.y * WORLD_SIZE + WATER.x] = 4;
    const gz = Buffer.from(await encodeWorldMap(tiles)).toString('base64');
    store = new Map<string, { value: unknown; cid: string }>([
      [COL('map'), { value: { size: WORLD_SIZE, gz }, cid: 'map1' }],
      [COL('npcs'), { value: { npcs: [NPC] }, cid: 'npc1' }],
    ]);
    pds = fakePds(store);
    globalThis.fetch = pds.fn;
    resetAuthoredWorldCache();
  });
  afterEach(() => {
    globalThis.fetch = orig;
    resetAuthoredWorldCache();
    setWorldMap(null); setNpcs(null); setInteriors([], []); setItemOverrides(null); setStory(null); setScenario(null); setMonsterOverrides(TEST_MONSTERS);
  });
  it('無効・鍵なし・鍵違い・許可外 name は通常の not_found と同じ 404', async () => {
    for (const [env, req] of [
      [await makeEnv({ ADMIN_DATA_API_ENABLED: undefined }), call('GET', 'npcs')],
      [await makeEnv({ ADMIN_DATA_API_KEY: undefined }), call('GET', 'npcs')],
      [await makeEnv(), call('GET', 'npcs', { key: null })],
      [await makeEnv(), call('GET', 'npcs', { key: 'wrong' })],
      [await makeEnv(), call('GET', 'map')],
      [await makeEnv(), call('PUT', 'jobs', { body: { value: {}, swapCid: null } })],
    ] as const) {
      const res = await handleRequest(req, env);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found', path: new URL(req.url).pathname });
    }
    expect(pds.puts).toHaveLength(0);
  });

  it('GET npcs は cid・value と全 NPC の配置問題を返す', async () => {
    store.set(COL('npcs'), { value: { npcs: [NPC, { ...NPC, id: 'wet', name: '溤れ', ...WATER }] }, cid: 'npc1' });
    const res = await handleRequest(call('GET', 'npcs'), await makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { cid: string; value: { npcs: NpcDef[] }; placementIssues: Array<{ id: string; reason: string }> };
    expect(body.cid).toBe('npc1');
    expect(body.value.npcs.map((n) => n.id)).toEqual(['elder', 'wet']);
    expect(body.placementIssues).toEqual([{ id: 'wet', reason: expect.stringContaining('歩けない') }]);
  });

  it('GET でレコードが無ければ cid/value は null', async () => {
    const res = await handleRequest(call('GET', 'quests'), await makeEnv());
    expect(await res.json()).toEqual({ name: 'quests', collection: COL('quests'), cid: null, value: null });
  });

  it('PUT の検証失敗は 400 で書かない (構造・水の上への移動)', async () => {
    for (const value of [{ npcs: [{ ...NPC, lines: [] }] }, { npcs: [{ ...NPC, ...WATER }] }]) {
      const res = await handleRequest(call('PUT', 'npcs', { body: { value, swapCid: 'npc1' } }), await makeEnv());
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe('validation_failed');
    }
    expect(pds.puts).toHaveLength(0);
  });

  it('dryRun は検証だけして書かない', async () => {
    const value = { npcs: [{ ...NPC, x: 301 }] };
    const res = await handleRequest(call('PUT', 'npcs', { body: { value, swapCid: 'npc1', dryRun: true } }), await makeEnv());
    expect(await res.json()).toEqual({ ok: true, dryRun: true });
    expect(pds.puts).toHaveLength(0);
  });

  it('swapCid が古ければ 409', async () => {
    const res = await handleRequest(call('PUT', 'npcs', { body: { value: { npcs: [{ ...NPC, x: 301 }] }, swapCid: 'stale' } }), await makeEnv());
    expect(res.status).toBe(409);
    expect(pds.puts).toHaveLength(0);
  });

  it('正常な PUT は swapRecord 付きで書き、新しい cid を返す', async () => {
    const res = await handleRequest(call('PUT', 'npcs', { body: { value: { npcs: [{ ...NPC, x: 301 }] }, swapCid: 'npc1' } }), await makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cid: 'new1' });
    expect(pds.puts).toHaveLength(1);
    expect(pds.puts[0]).toMatchObject({ collection: COL('npcs'), swapRecord: 'npc1', record: { $type: COL('npcs'), npcs: [{ id: 'elder', x: 301 }] } });
    expect(typeof pds.puts[0]!.record.updatedAt).toBe('string');
  });

  it('dev エッジ (ADMIN_NSID_ENV=dev) は app.aozoraquest.dev.world.* を読み書きし、本番側には触れない (#716)', async () => {
    const DEV = (name: string) => `app.aozoraquest.dev.world.${name}`;
    const env = await makeEnv({ ADMIN_NSID_ENV: 'dev' });
    store.set(DEV('map'), store.get(COL('map'))!);
    const got = await (await handleRequest(call('GET', 'quests'), env)).json();
    expect(got).toEqual({ name: 'quests', collection: DEV('quests'), cid: null, value: null });
    const res = await handleRequest(call('PUT', 'npcs', { body: { value: { npcs: [{ ...NPC, x: 301 }] }, swapCid: null } }), env);
    expect(await res.json()).toEqual({ ok: true, cid: 'new1' });
    expect(pds.puts.map((p) => [p.collection, p.record.$type])).toEqual([[DEV('npcs'), DEV('npcs')]]);
    expect(store.get(COL('npcs'))).toEqual({ value: { npcs: [NPC] }, cid: 'npc1' });
  });

  describe('items (D-STORY-008)', () => {
    const items = () => Object.entries(ITEMS).map(([id, v]) => ({ id, ...v }));
    const equipment = () => activeEquipment().map((e) => ({ ...e }));
    const DEV = 'app.aozoraquest.dev.world.items';

    it('GET / PUT items は dev の items コレクションを CAS で読み書きする', async () => {
      const env = await makeEnv({ ADMIN_NSID_ENV: 'dev' });
      store.set('app.aozoraquest.dev.world.map', store.get(COL('map'))!);
      expect(await (await handleRequest(call('GET', 'items'), env)).json()).toEqual({ name: 'items', collection: DEV, cid: null, value: null });
      const value = { items: [...items(), { id: 'ember-stone', name: 'ほむらのいし' }], equipment: equipment() };
      const res = await handleRequest(call('PUT', 'items', { body: { value, swapCid: null } }), env);
      expect(await res.json()).toEqual({ ok: true, cid: 'new1' });
      expect(pds.puts.map((p) => [p.collection, p.swapRecord])).toEqual([[DEV, null]]);
      expect(await (await handleRequest(call('GET', 'items'), env)).json()).toMatchObject({ cid: 'new1', value: { items: expect.arrayContaining([{ id: 'ember-stone', name: 'ほむらのいし' }]) } });
      const stale = await handleRequest(call('PUT', 'items', { body: { value, swapCid: null } }), env);
      expect(stale.status).toBe(409);
    });

    it('検証: 装備が空 (読み込みで無視される)・壊れた装備・参照中のアイテム削除は 400 で書かない (dryRun も同じ)', async () => {
      const env = await makeEnv();
      const bad = [
        { items: items() },
        { items: items(), equipment: [] },
        { items: items(), equipment: [{ ...equipment()[0]!, slot: 'tail' }] },
        { items: items().filter((it) => it.id !== 'herb'), equipment: equipment() },
      ];
      for (const value of bad) for (const dryRun of [false, true]) {
        const res = await handleRequest(call('PUT', 'items', { body: { value, swapCid: null, dryRun } }), env);
        expect(res.status).toBe(400);
        expect((await res.json() as { error: string }).error).toBe('validation_failed');
      }
      expect(pds.puts).toHaveLength(0);
      const ok = await handleRequest(call('PUT', 'items', { body: { value: { items: items(), equipment: equipment() }, swapCid: null, dryRun: true } }), env);
      expect(await ok.json()).toEqual({ ok: true, dryRun: true });
      expect(Object.keys(ITEMS)).toContain('herb');
    });
  });

  describe('monsters (D-STORY-009)', () => {
    const monsters = () => activeMonsters().map((m) => ({ ...m }));
    const BOSS = { ...activeMonsters()[0]!, id: 'story-boss', name: 'ぬしの影', storyOnly: true };

    it('PUT monsters はストーリー専用の敵を足して書ける', async () => {
      const res = await handleRequest(call('PUT', 'monsters', { body: { value: { monsters: [...monsters(), BOSS] }, swapCid: null } }), await makeEnv());
      expect(await res.json()).toEqual({ ok: true, cid: 'new1' });
      expect(pds.puts.map((p) => p.collection)).toEqual([COL('monsters')]);
    });

    it('PUT monsters は小数を文字列でレコードに書き、GET は数値に戻して返す (#740)', async () => {
      const value = { monsters: monsters().map((m, i) => (i === 0 ? { ...m, spawnWeight: 0.4, drops: [{ item: 'herb', chance: 0.3 }] } : m)) };
      const env = await makeEnv();
      const res = await handleRequest(call('PUT', 'monsters', { body: { value, swapCid: null } }), env);
      expect(await res.json()).toEqual({ ok: true, cid: 'new1' });
      const written = pds.puts[0]!.record.monsters as Array<{ spawnWeight?: unknown; drops: Array<{ chance: unknown }> }>;
      expect(written[0]).toMatchObject({ spawnWeight: '0.4', drops: [{ item: 'herb', chance: '0.3' }] });
      const floats: number[] = [];
      JSON.stringify(pds.puts[0]!.record, (_k, v: unknown) => { if (typeof v === 'number' && !Number.isInteger(v)) floats.push(v); return v; });
      expect(floats).toEqual([]); // PDS は整数以外の数値を拒否する
      const got = await (await handleRequest(call('GET', 'monsters'), env)).json() as { value: { monsters: unknown[] } };
      expect(got.value.monsters).toEqual(value.monsters);
    });

    it('何も読み込まれていない状態で monsters 候補を検証したあとも 0 体のまま (D-MONSTER-001)', async () => {
      const candidate = { monsters: monsters() };
      clearMonsters();
      const res = await handleRequest(call('PUT', 'monsters', { body: { value: candidate, swapCid: null, dryRun: true } }), await makeEnv());
      expect(await res.json()).toEqual({ ok: true, dryRun: true });
      expect(activeMonsters()).toHaveLength(0);
    });

    it('ストーリー戦闘が使っている敵を消すと 400 で書かない', async () => {
      const used = activeMonsters()[0]!.id;
      store.set(COL('story'), { value: { battles: [{ id: 'b1', monsterId: used, count: 1, winFlag: 'won-b1' }] }, cid: 'st1' });
      const value = { monsters: monsters().filter((m) => m.id !== used) };
      const res = await handleRequest(call('PUT', 'monsters', { body: { value, swapCid: null } }), await makeEnv());
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation_failed', message: expect.stringContaining(used) });
      expect(pds.puts).toHaveLength(0);
      expect(MONSTERS_BY_ID[used]).toBeDefined();
    });
  });

  describe('story (D-STORY-009)', () => {
    const flags = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
    const item = (over: Record<string, unknown> = {}) => ({ id: 'pi-key', mapId: 'cave-1', x: 4, y: 7, itemId: 'herb', count: 1, flag: 'got-key', ...over });
    const put = async (name: string, value: unknown) => (await handleRequest(call('PUT', name, { body: { value, swapCid: null, dryRun: true } }), await makeEnv())).status;

    it('シナリオと置きアイテムのフラグ数の合計が 500 を超えると、どちらを保存しても 400', async () => {
      store.set(COL('scenario'), { value: { events: [{ id: 'e1', title: 't', when: [], setFlags: flags(500) }] }, cid: 's1' });
      expect(await put('story', { placedItems: [item()] })).toBe(400);
      expect(await put('story', { placedItems: [item({ flag: 'f0' })] })).toBe(200); // 同じ名前は 1 つと数える
      store.delete(COL('scenario')); setScenario(null); // レコードが無ければ読み込みは触らないので、前の適用を消す
      store.set(COL('story'), { value: { placedItems: [item()] }, cid: 'st1' });
      expect(await put('scenario', { events: [{ id: 'e1', title: 't', when: [], setFlags: flags(500) }] })).toBe(400);
      expect(pds.puts).toHaveLength(0);
    });

    it('フィールドの町のマス・flag なしは 400', async () => {
      const town = worldOverlay().towns[0]!;
      expect(await put('story', { placedItems: [item({ mapId: 'world', x: town.x, y: town.y })] })).toBe(400);
      expect(await put('story', { placedItems: [item({ flag: undefined })] })).toBe(400);
    });
  });
});
