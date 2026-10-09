/**
 * 管理ワールドの共通ローダー (Refs #718)。web と edge の両方がこれを通る。
 * 順序と適用規則 (#660: 無ければ触らない / 空配列も適用 / monsters・items は空なら触らない)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_WORLD_RECORDS, activeMonsters, allNpcs, clearMonsters, encodeMonstersForRecord, gameQuests, loadAdminWorld,
  scenarioEvents, setGameQuests, setMonsterOverrides, setNpcs, setScenario, setShopOverrides, shopOverrides,
  type AdminWorldRecordCache, type AdminWorldRecordName, type MonsterDef, type NpcDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

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

/** KV の last-good (dev の実データと同じ 21 体: 20 体 + ストーリー専用 1 体)。 */
const CACHED: MonsterDef[] = [...TEST_MONSTERS, { ...TEST_MONSTERS[0]!, id: 'golden-lantern', name: 'こがねランタン', storyOnly: true }];
const record = (list: readonly MonsterDef[]) => ({ monsters: encodeMonstersForRecord([...list]), updatedAt: '2026-10-09T00:00:00Z' });

function fakeCache(value: unknown): AdminWorldRecordCache & { write: ReturnType<typeof vi.fn> } {
  return { names: ['monsters'], read: vi.fn(async () => value), write: vi.fn(async () => {}) };
}

async function loadMonsters(pds: () => unknown, cache: AdminWorldRecordCache) {
  const errors: AdminWorldRecordName[] = [];
  await loadAdminWorld(async (name) => (name === 'monsters' ? pds() : null), (name) => errors.push(name), cache);
  return errors;
}

describe('loadAdminWorld: monsters の cache 経路 (D-MONSTER-001)', () => {
  afterEach(() => setMonsterOverrides(TEST_MONSTERS));

  const failing: Array<[string, () => unknown]> = [
    ['PDS が throw', () => { throw new Error('pds down'); }],
    ['RecordNotFound (null)', () => null],
    ['monsters 配列が空', () => ({ monsters: [], updatedAt: 'x' })],
    ['検証 NG (tier1 が 1 体)', () => record([TEST_MONSTERS[0]!])],
  ];
  for (const [label, pds] of failing) {
    it(`${label} のときは KV の 21 体が入り、write しない`, async () => {
      clearMonsters();
      const cache = fakeCache(record(CACHED));
      const errors = await loadMonsters(pds, cache);
      expect(activeMonsters().map((m) => m.id)).toEqual(CACHED.map((m) => m.id));
      expect(cache.write).not.toHaveBeenCalled();
      expect(errors).toEqual(label.startsWith('RecordNotFound') ? [] : ['monsters']);
    });
  }

  it('PDS が OK なら PDS の値を適用し、その値で write を 1 回呼ぶ', async () => {
    clearMonsters();
    const value = record(TEST_MONSTERS);
    const cache = fakeCache(record(CACHED));
    await loadMonsters(() => value, cache);
    expect(activeMonsters()).toHaveLength(TEST_MONSTERS.length);
    expect(cache.write).toHaveBeenCalledTimes(1);
    expect(cache.write).toHaveBeenCalledWith('monsters', value);
    expect(cache.read).not.toHaveBeenCalled();
  });

  it('PDS も KV も無ければ 0 体のまま (新規環境は戦闘なし)', async () => {
    clearMonsters();
    await loadMonsters(() => null, fakeCache(null));
    expect(activeMonsters()).toHaveLength(0);
  });

  it('cache が無くても、空のレコードは今の値を触らずエラーとして報告する', async () => {
    const errors: AdminWorldRecordName[] = [];
    await loadAdminWorld(async (name) => (name === 'monsters' ? { monsters: [] } : null), (name) => errors.push(name));
    expect(activeMonsters()).toHaveLength(TEST_MONSTERS.length);
    expect(errors).toEqual(['monsters']);
  });
});
