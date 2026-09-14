/**
 * 手編集ワールドの読み込み (web 側) — レコードの**有無**で適用を決める (#660)。
 * edge (`apps/edge/test/world-authoring.test.ts`) と同じ不変条件:
 *   - レコードが存在すれば**空配列でも適用する** (全削除の保存は {npcs: []})
 *   - レコードが無ければ触らない
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import { allNpcs, setNpcs, setInteriors, starterTownNpcs, starterTownQuests, starterTownScenario, setGameQuests, gameQuests, setScenario, scenarioEvents, setShopOverrides, shopOverrides, type NpcDef, type ShopOverride } from '@aozoraquest/core';
import { loadAuthoredWorld, loadQuestAuthoringRecords, loadScenarioRecord, saveGameQuests, saveScenario } from './world-authoring';

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
