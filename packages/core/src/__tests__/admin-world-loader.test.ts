/**
 * 管理ワールドの共通ローダー (Refs #718)。web と edge の両方がこれを通る。
 * 順序と適用規則 (#660: 無ければ触らない / 空配列も適用 / monsters・items は空なら触らない)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN_WORLD_RECORDS, allNpcs, gameQuests, loadAdminWorld, scenarioEvents, setGameQuests, setNpcs, setScenario,
  setShopOverrides, shopOverrides, type AdminWorldRecordName, type NpcDef,
} from '../index.js';

const NPC: NpcDef = { id: 'elder', name: '長老', x: 3, y: 4, lines: ['やあ'] };

async function load(records: Partial<Record<AdminWorldRecordName, unknown>>, fail: AdminWorldRecordName[] = []) {
  const read: AdminWorldRecordName[] = [];
  const errors: AdminWorldRecordName[] = [];
  await loadAdminWorld(async (name) => {
    read.push(name);
    if (fail.includes(name)) throw new Error(`boom ${name}`);
    return records[name] ?? null;
  }, (name) => errors.push(name));
  return { read, errors };
}

describe('loadAdminWorld', () => {
  afterEach(() => { setNpcs(null); setShopOverrides(null); setGameQuests(null); setScenario(null); });

  it('読み込み順は唯一の定義 (shops は items の後、quests は npcs/monsters/items の後、scenario は quests の後、story は scenario の後)', async () => {
    const { read } = await load({});
    expect(read).toEqual([...ADMIN_WORLD_RECORDS]);
    expect(read).toEqual(['map', 'tileArt', 'monsters', 'items', 'shops', 'npcs', 'jobs', 'interiors', 'quests', 'scenario', 'story']);
  });

  it('空配列のレコードは適用する (#660)', async () => {
    setNpcs([NPC]);
    setShopOverrides([{ x: 10, y: 20, consumables: [] }]);
    await load({ npcs: { npcs: [] }, shops: { shops: [] }, quests: { quests: [] }, scenario: { events: [] } });
    expect(allNpcs()).toEqual([]);
    expect(shopOverrides()).toEqual([]);
    expect(gameQuests()).toEqual([]);
    expect(scenarioEvents()).toEqual([]);
  });

  it('レコードが無ければメモリの定義を保持する', async () => {
    setNpcs([NPC]);
    await load({});
    expect(allNpcs().map((n) => n.id)).toEqual(['elder']);
  });

  it('1 レコードの失敗は後続を止めない (地図の失敗でも NPC は読む)', async () => {
    setNpcs([NPC]);
    const { errors } = await load({ npcs: { npcs: [] } }, ['map', 'shops']);
    expect(errors).toEqual(['map', 'shops']);
    expect(allNpcs()).toEqual([]);
  });
});
