/**
 * 属性の魔石 (D-MATERIAL-001)。プレイヤーに見えるきまり: 勝つと敵の属性の魔石を必ずもらえる・強い敵ほど多い・
 * 店の値札は町の魔石 (属性つきの品は 3 分の 1 がその属性)・ひきとりは 15 個でパワー 1・負けると魔石は 3 個ずつなくす。
 * ここでは既存の公開 API (rollDrops / rollDefeatLoss / townShopStock / SALE_TUNING / ITEMS) だけで確かめる。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as core from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const { rollDrops, rollDefeatLoss, ITEMS, SALE_TUNING, salePowerFor, isSellableMaterial, setMonsterOverrides, setShopOverrides, townShopStock, worldOverlay, rollSearch } = core;

const count = (list: readonly string[], id: string) => list.filter((x) => x === id).length;

afterEach(() => {
  setMonsterOverrides(TEST_MONSTERS);
  setShopOverrides(null);
});

describe('勝ったときの魔石', () => {
  it('どの敵も、自分の属性の魔石を必ず落とす (うん 0)。属性の無い敵は空の魔石', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(count(rollDrops('sky-slime', 0, seed), 'stone-water')).toBe(1);
      expect(count(rollDrops('cave-bat', 0, seed), 'stone-wind')).toBe(1);
      expect(count(rollDrops('stray-slime', 0, seed), 'stone-void')).toBe(3); // Lv4・めずらしい (×3) = 3、属性なし→空
    }
  });

  it('強い敵ほど多い: 1 + 想定Lv÷10 (切り捨て)、ボスは +2、めずらしい敵は 3 倍', () => {
    expect(count(rollDrops('marsh-serpent', 0, 1), 'stone-water')).toBe(2); // Lv10
    expect(count(rollDrops('sky-dragon', 0, 1), 'stone-void')).toBe(3); // Lv27
    expect(count(rollDrops('red-slime', 0, 1), 'stone-fire')).toBe(3); // Lv2・めずらしい
    setMonsterOverrides([...TEST_MONSTERS, { ...TEST_MONSTERS.find((m) => m.id === 'sky-dragon')!, id: 'boss-x', storyOnly: true, level: 30, patternSets: [{ patterns: [{ weight: 1, steps: [{ move: 'attack' }, { move: 'attack' }] }] }] }]);
    expect(count(rollDrops('boss-x', 0, 1), 'stone-void')).toBe(6); // 1 + 3 + 2
  });

  it('データの stones (整数) があればそれを使う', () => {
    setMonsterOverrides(TEST_MONSTERS.map((m) => (m.id === 'sky-slime' ? { ...m, stones: 4 } : m)));
    expect(count(rollDrops('sky-slime', 0, 7), 'stone-water')).toBe(4);
  });

  it('うんが高いと、ときどき 1 個多い (多くても 1 個)', () => {
    let extra = 0;
    for (let seed = 0; seed < 400; seed++) {
      const n = count(rollDrops('sky-slime', 400, seed), 'stone-water');
      expect(n === 1 || n === 2).toBe(true);
      if (n === 2) extra++;
    }
    expect(extra).toBeGreaterThan(300); // 上限 0.95
  });

  it('旧素材 (スライムのしずく など) はもう落とさない。やくそうなど消耗品はそのまま確率で落とす', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed++) for (const id of rollDrops('sky-slime', 30, seed)) seen.add(id);
    expect(seen.has('slime-drop')).toBe(false);
    expect(seen.has('herb')).toBe(true);
  });

  it('魔石 5 種は、どうぐのデータに無くても名前がある', () => {
    core.setItemOverrides({ items: [{ id: 'herb', name: 'やくそう' }], equipment: [...core.activeEquipment()] });
    try {
      expect(ITEMS['stone-fire']?.name).toBe('火の魔石');
      expect(ITEMS['stone-void']?.name).toBe('空の魔石');
    } finally {
      core.setItemOverrides(null);
    }
  });
});

describe('ひきとり・負けたとき', () => {
  it('魔石 15 個でパワー 1。旧素材はひきとらない', () => {
    expect(SALE_TUNING.materialsPerPower).toBe(15);
    expect(salePowerFor(14)).toBe(0);
    expect(salePowerFor(30)).toBe(2);
    expect(isSellableMaterial('stone-earth')).toBe(true);
    expect(isSellableMaterial('slime-drop')).toBe(false);
  });

  it('負けたとき、魔石は 1 回で 3 個なくす (いちばん多くて 9 個)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const lost = rollDefeatLoss({ 'stone-water': 40 }, 0, seed);
      expect(lost.length % 3).toBe(0);
      expect(lost.length).toBeGreaterThanOrEqual(3);
      expect(lost.length).toBeLessThanOrEqual(9);
    }
    expect(rollDefeatLoss({ 'stone-water': 2 }, 0, 1)).toEqual(['stone-water', 'stone-water']); // 手持ちより多くはなくさない
  });

  it('しらべるで見つかる地方の素材は、その tier の敵の魔石', () => {
    const found = new Set<string>();
    for (let seed = 0; seed < 600; seed++) { const r = rollSearch(seed, 80, 1); if (r) found.add(r); }
    expect([...found].filter((id) => id.startsWith('stone-')).sort()).toEqual(['stone-earth', 'stone-fire', 'stone-water', 'stone-wind']);
    expect(found.has('slime-drop')).toBe(false);
  });
});

describe('町の魔石 (店の値札)', () => {
  it('店のデータのテーマがあれば、値札はその属性の魔石', () => {
    const t = worldOverlay().towns[0]!;
    setShopOverrides([{ x: t.x, y: t.y, theme: 'fire' }]);
    expect(townShopStock(t, 0).materialId).toBe('stone-fire');
  });

  it('テーマが無い町も、魔石で払う (旧素材を求めない)', () => {
    worldOverlay().towns.forEach((t, i) => expect(townShopStock(t, i).materialId).toMatch(/^stone-(earth|water|fire|wind|void)$/));
  });
});
