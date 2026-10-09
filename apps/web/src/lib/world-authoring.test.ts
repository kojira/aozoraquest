/**
 * 手編集ワールドの読み込み (web 側) — レコードの**有無**で適用を決める (#660)。
 * edge (`apps/edge/test/world-authoring.test.ts`) と同じ不変条件:
 *   - レコードが存在すれば**空配列でも適用する** (全削除の保存は {npcs: []})
 *   - レコードが無ければ触らない
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { jsonToLex, type Agent } from '@atproto/api';
import { activeMonsters, clearMonsters, clearMonsterArts, monsterArtSvg, encodeMonstersForRecord, setMonsterOverrides, type GameQuestDef, type MonsterDef, allNpcs, setNpcs, setInteriors, starterTownNpcs, starterTownQuests, starterTownScenario, setGameQuests, gameQuests, gameQuestsByNpc, setScenario, scenarioEvents, setShopOverrides, shopOverrides, type NpcDef, type ShopOverride } from '@aozoraquest/core';
import { loadAuthoredWorld, loadQuestAuthoringRecords, loadScenarioRecord, saveGameQuests, saveScenario } from './world-authoring';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';

const DID = 'did:plc:admin';
const NPC: NpcDef = { id: 'elder', name: '長老', x: 3, y: 4, lines: ['やあ'] };
const SHOP: ShopOverride = { x: 10, y: 20, consumables: [] };

/** 管理者 repo のふり。`records` に無いコレクションは RecordNotFound を投げる。 */
function fakeAgent(records: Record<string, unknown>): Agent {
  const getRecord = async ({ collection }: { collection: string }) => {
    const key = collection.slice(collection.lastIndexOf('.') + 1);
    if (key in records) return { data: { uri: `at://${DID}/${collection}/self`, cid: 'cid1', value: records[key] } };
    const err = new Error('Could not locate record');
    err.name = 'RecordNotFoundError';
    throw err;
  };
  return { com: { atproto: { repo: { getRecord } } } } as unknown as Agent;
}

describe('loadAuthoredWorld: 空配列のレコードを適用する (#660)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ADMIN_DIDS', DID);
    setNpcs([NPC]);
    setShopOverrides([SHOP]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setNpcs(null);
    setShopOverrides(null);
  });

  it('NPC: {npcs: []} で全 NPC が消える', async () => {
    await loadAuthoredWorld(fakeAgent({ npcs: { npcs: [] } }));
    expect(allNpcs()).toEqual([]);
  });

  it('NPC: レコードが無ければメモリの NPC を保持する', async () => {
    await loadAuthoredWorld(fakeAgent({}));
    expect(allNpcs().map((n) => n.id)).toEqual(['elder']);
  });

  it('NPC: 実 Agent が BlobRef に復元した会話イラストも適用する (#703)', async () => {
    // Agent の getRecord は jsonToLex を通すので blob は BlobRef になる (素の JSON ではない)。
    const portraitImage = { blob: { $type: 'blob' as const, ref: { $link: 'bafkreiggoeve4m273n6umssqskhmof5k3ttaob3qlo46b7h2qk7h4x5dka' }, mimeType: 'image/webp' as const, size: 82630 }, width: 512, height: 768 };
    const npcs = starterTownNpcs().map((n) => n.id === 'futaba-bluesky' ? { ...n, portraitImage } : n);
    const record = jsonToLex({ npcs }) as { npcs: Array<{ portraitImage?: { blob: object } }> };
    expect(record.npcs.find((n) => n.portraitImage)?.portraitImage?.blob.constructor.name).toBe('BlobRef');
    await loadAuthoredWorld(fakeAgent({ npcs: record }));
    expect(allNpcs().find((n) => n.id === 'futaba-bluesky')?.portraitImage).toEqual(portraitImage);
  });

  it('店: {shops: []} で全上書きが外れる', async () => {
    await loadAuthoredWorld(fakeAgent({ shops: { shops: [] } }));
    expect(shopOverrides()).toEqual([]);
  });

  it('店: レコードが無ければメモリの上書きを保持する', async () => {
    await loadAuthoredWorld(fakeAgent({}));
    expect(shopOverrides().map((s) => [s.x, s.y])).toEqual([[10, 20]]);
  });
});

describe('導入データ: draftと保存済み定義の境界', () => {
  afterEach(() => { setScenario(null); setGameQuests(null); setNpcs(null); setInteriors(null, []); });
  it('保存失敗はクエスト/シナリオのglobal定義を変えない。成功後だけ反映', async () => {
    setNpcs(starterTownNpcs());
    const quests = starterTownQuests();
    const putRecord = vi.fn().mockRejectedValue(new Error('offline'));
    const agent = { assertDid: DID, com: { atproto: { repo: { putRecord } } } } as unknown as Agent;
    await expect(saveGameQuests(agent, quests)).rejects.toThrow('offline');
    expect(gameQuests()).toEqual([]);
    putRecord.mockResolvedValue({});
    await saveGameQuests(agent, quests);
    expect(gameQuests()).toEqual(quests);
    putRecord.mockRejectedValue(new Error('offline'));
    await expect(saveScenario(agent, starterTownScenario())).rejects.toThrow('offline');
    expect(scenarioEvents()).toEqual([]);
    putRecord.mockResolvedValue({});
    await saveScenario(agent, starterTownScenario());
    expect(scenarioEvents()).toEqual(starterTownScenario());
  });
  it('saves and reloads multiple identical-title quests for the same NPC through the real validator', async () => {
    setNpcs(starterTownNpcs());
    const q = starterTownQuests().find(q => q.id === 'futaba-tool-care')!;
    const quests = [q, { ...q, id: 'fixture-b' }];
    const putRecord = vi.fn().mockResolvedValue({});
    const agent = { assertDid: DID, com: { atproto: { repo: { putRecord } } } } as unknown as Agent;
    await saveGameQuests(agent, quests);
    expect(putRecord.mock.calls[0]![0].record.quests).toEqual(quests);
    expect(await loadQuestAuthoringRecords(fakeAgent({ npcs: { npcs: starterTownNpcs() }, quests: { quests } }), DID)).toEqual(quests);
    expect(gameQuestsByNpc(q.npcId).map(q => q.id)).toEqual([q.id, 'fixture-b']);
  });
  it('未作成は空。通信/認証失敗はnot foundを含むメッセージでも伝播する', async () => {
    expect(await loadQuestAuthoringRecords(fakeAgent({}), DID)).toEqual([]);
    for (const error of [new Error('network unavailable'), Object.assign(new Error('session not found'), { error: 'AuthenticationRequired' })]) {
      const agent = { com: { atproto: { repo: { getRecord: vi.fn().mockRejectedValue(error) } } } } as unknown as Agent;
      await expect(loadQuestAuthoringRecords(agent, DID)).rejects.toBe(error);
      await expect(loadScenarioRecord(agent, DID)).rejects.toBe(error);
    }
  });
});

describe('NPC editor strict load and save', () => {
  afterEach(() => { setNpcs(null); setInteriors(null, []); setGameQuests(null); });
  it('never publishes failed NPC saves; presets write only NPC records', async () => {
    const { saveNpcs } = await import('./world-authoring');
    setNpcs([NPC]);
    const next = [{ ...NPC, spritePreset: 'boy' as const }];
    const putRecord = vi.fn().mockRejectedValue(new Error('offline'));
    const agent = { assertDid: DID, com: { atproto: { repo: { putRecord } } } } as unknown as Agent;
    await expect(saveNpcs(agent, next)).rejects.toThrow('offline');
    expect(allNpcs()).toEqual([NPC]);
    putRecord.mockResolvedValue({});
    await saveNpcs(agent, next);
    expect(allNpcs()).toEqual(next);
    expect(putRecord.mock.calls.every(([p]) => p.collection.endsWith('.world.npcs'))).toBe(true);
  });
  it('only true absence allows bundled/empty data, and stale loads cannot publish', async () => {
    const { loadNpcAuthoringRecords } = await import('./world-authoring');
    const empty = await loadNpcAuthoringRecords(fakeAgent({}), DID);
    expect(empty.list).toEqual([]); expect(empty.world.bundled).toBe(true);
    expect(empty.world.tiles.length).toBe(1024 ** 2);
    for (const record of [{ map: { size: 1024, gz: 'not gzip' } }, { npcs: {} }, { tileArt: { arts: { 'npc:x': { size: 16, palette: [''], pixels: 'aA==' } } } }]) {
      await expect(loadNpcAuthoringRecords(fakeAgent(record), DID)).rejects.toThrow();
    }
    const error = Object.assign(new Error('not found session'), { error: 'AuthenticationRequired' });
    const agent = { com: { atproto: { repo: { getRecord: vi.fn().mockRejectedValue(error) } } } } as unknown as Agent;
    await expect(loadNpcAuthoringRecords(agent, DID)).rejects.toBe(error);
    setNpcs([NPC]);
    await expect(loadNpcAuthoringRecords(fakeAgent({}), DID, () => false)).rejects.toThrow('取り消し');
    expect(allNpcs()).toEqual([NPC]);
  });
});

describe('loadAuthoredWorld: monsters は PDS が読めないとき edge の last-good へ倒れる (D-MONSTER-001)', () => {
  const CACHED: MonsterDef[] = [...TEST_MONSTERS, { ...TEST_MONSTERS[0]!, id: 'golden-lantern', name: 'こがねランタン', storyOnly: true }];
  const quest: GameQuestDef = { id: 'q-lantern', title: 'ランタン退治', npcId: 'elder', intro: ['たのむ'], done: ['ありがとう'], objective: { kind: 'defeat', monsterId: 'golden-lantern', count: 1 } };
  /** monsters だけ getRecord が reject する管理者 repo (他は fakeAgent と同じ)。 */
  function agentWithMonstersDown(records: Record<string, unknown>): Agent {
    const ok = fakeAgent(records).com.atproto.repo.getRecord;
    const getRecord = async (p: { collection: string }) => {
      if (p.collection.endsWith('.world.monsters')) throw new Error('XRPC upstream failure');
      return ok(p as never);
    };
    return { com: { atproto: { repo: { getRecord } } } } as unknown as Agent;
  }
  const fetchSpy = vi.fn();
  const edgeCalls = (name: string) => fetchSpy.mock.calls.filter(([url]) => String(url).endsWith(`/api/world/admin-cache?name=${name}`)).length;

  beforeEach(() => {
    vi.stubEnv('VITE_ADMIN_DIDS', DID);
    clearMonsters();
    setNpcs([NPC]);
    fetchSpy.mockReset().mockImplementation(async (url: string) => (url.includes('/api/world/admin-cache?name=monsters')
      ? new Response(JSON.stringify({ cid: 'cid-kv', value: { monsters: encodeMonstersForRecord(CACHED), updatedAt: 'x' } }), { status: 200 })
      : new Response('{}', { status: 404 })));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    setMonsterOverrides(TEST_MONSTERS); setNpcs(null); setGameQuests(null);
  });

  it('PDS の monsters が reject でも edge から 21 体が入り、続く quests の実在検査が通る', async () => {
    await loadAuthoredWorld(agentWithMonstersDown({ npcs: { npcs: [NPC] }, quests: { quests: [quest] } }));
    expect(activeMonsters().map((m) => m.id)).toEqual(CACHED.map((m) => m.id));
    expect(gameQuests().map((q) => q.id)).toEqual(['q-lantern']);
    expect(edgeCalls('monsters')).toBe(1);
  });

  it('PDS の monsters が読めれば edge を呼ばない', async () => {
    await loadAuthoredWorld(fakeAgent({ monsters: { monsters: encodeMonstersForRecord([...TEST_MONSTERS]), updatedAt: 'x' } }));
    expect(activeMonsters()).toHaveLength(TEST_MONSTERS.length);
    expect(edgeCalls('monsters')).toBe(0);
  });

  it('PDS に monsterArt が無ければ edge の last-good の絵が入る (PR2)', async () => {
    const art = { arts: [{ id: 'slime', svg: '<g fill="{{tint|#57b7ee}}"/>' }], updatedAt: 'x' };
    fetchSpy.mockImplementation(async (url: string) => (url.includes('/api/world/admin-cache?name=monsterArt')
      ? new Response(JSON.stringify({ cid: 'cid-art', value: art }), { status: 200 })
      : new Response('{}', { status: 404 })));
    await loadAuthoredWorld(fakeAgent({ monsters: { monsters: encodeMonstersForRecord([...TEST_MONSTERS]), updatedAt: 'x' } }));
    expect(monsterArtSvg('slime', undefined)).toContain('#57b7ee');
    expect(edgeCalls('monsterArt')).toBe(1);
    clearMonsterArts();
  });

  it('NPC エディタの厳密な読み込みは monsters レコードが無ければ今の値を残す (0 体にしない)', async () => {
    const { loadNpcAuthoringRecords } = await import('./world-authoring');
    setMonsterOverrides(CACHED);
    setGameQuests([quest]);
    await loadNpcAuthoringRecords(fakeAgent({ npcs: { npcs: [NPC] }, quests: { quests: [quest] } }), DID);
    expect(activeMonsters()).toHaveLength(CACHED.length);
    expect(gameQuests().map((q) => q.id)).toEqual(['q-lantern']);
    expect(fetchSpy).not.toHaveBeenCalled(); // 厳密な読み込みは edge を読まない
  });
});
