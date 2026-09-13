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
