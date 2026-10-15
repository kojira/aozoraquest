import { describe, it, expect } from 'vitest';
import {
  BATTLE_TUNING,
  rollDefeatLoss,
  rollDrops,
  rollSearch,
  SEARCH_TUNING,
  earnedTitles,
  MONSTERS,
  MONSTERS_BY_ID,
  ITEMS,
} from '../battle.js';

describe('rollDefeatLoss (敗北時の素材ドロップ)', () => {
  const inv = { herb: 2, 'slime-drop': 3, 'sky-dew': 1 };

  it('決定的 (同じ seed で同じ結果) で、手持ちが空なら何も落ちない', () => {
    expect(rollDefeatLoss(inv, 20, 42)).toEqual(rollDefeatLoss(inv, 20, 42));
    expect(rollDefeatLoss({}, 5, 1)).toEqual([]);
  });

  it('手持ちがあれば必ず 1 個以上、lossMax 以下。落ちるのは手持ちにある物だけで個数を超えない', () => {
    for (let seed = 0; seed < 200; seed++) {
      const lost = rollDefeatLoss(inv, 20, seed);
      expect(lost.length).toBeGreaterThanOrEqual(1);
      expect(lost.length).toBeLessThanOrEqual(BATTLE_TUNING.lossMax);
      const counts: Record<string, number> = {};
      for (const id of lost) counts[id] = (counts[id] ?? 0) + 1;
      for (const [id, n] of Object.entries(counts)) {
        expect(inv[id as keyof typeof inv], id).toBeGreaterThanOrEqual(n);
      }
    }
  });

  it('luk が低いほど複数落ちやすい (統計)', () => {
    const avg = (luk: number) => {
      let total = 0;
      for (let seed = 0; seed < 500; seed++) total += rollDefeatLoss(inv, luk, seed).length;
      return total / 500;
    };
    expect(avg(5)).toBeGreaterThan(avg(40));
  });
});

describe('rollDrops', () => {
  it('決定的 (同 seed 同結果)', () => {
    expect(rollDrops('sky-slime', 20, 42)).toEqual(rollDrops('sky-slime', 20, 42));
  });
  it('未知のモンスター ID は空配列', () => {
    expect(rollDrops('nope', 10, 1)).toEqual([]);
  });
  it('ドロップは定義済み素材のみ', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const m of MONSTERS) {
        for (const item of rollDrops(m.id, 30, seed)) {
          expect(ITEMS[item]).toBeDefined();
          expect(MONSTERS_BY_ID[m.id]!.drops.some((d) => d.item === item)).toBe(true);
        }
      }
    }
  });
  it('luk が高いほどドロップ総数が増える (統計的)', () => {
    let low = 0;
    let high = 0;
    for (let seed = 0; seed < 300; seed++) {
      low += rollDrops('sky-dragon', 0, seed).length;
      high += rollDrops('sky-dragon', 60, seed).length;
    }
    expect(high).toBeGreaterThan(low);
  });
});

describe('earnedTitles', () => {
  it('初勝利で最初の称号', () => {
    const titles = earnedTitles({ wins: 1, losses: 0, bestStreak: 1, tier3Wins: 0 });
    expect(titles.map((t) => t.id)).toEqual(['first-win']);
  });
  it('戦績 0 は称号なし', () => {
    expect(earnedTitles({ wins: 0, losses: 5, bestStreak: 0, tier3Wins: 0 })).toEqual([]);
  });
  it('上位条件で複数獲得 (単調)', () => {
    const titles = earnedTitles({ wins: 100, losses: 10, bestStreak: 12, tier3Wins: 15 });
    expect(titles.length).toBe(7);
  });
});

describe('rollSearch (しらべる — luk 連動でアイテム発見)', () => {
  it('決定的 (同 seed/luk/tier で同結果)', () => {
    expect(rollSearch(12345, 20, 1)).toBe(rollSearch(12345, 20, 1));
  });
  it('見つかったものは実在の素材 or 消耗品 id', () => {
    const valid = new Set(['herb', 'sky-dew', ...MONSTERS.filter((m) => m.tier === 1).flatMap((m) => m.drops.map((d) => d.item))]);
    for (let seed = 0; seed < 200; seed++) {
      const r = rollSearch(seed, 10, 1);
      if (r !== null) expect(valid.has(r)).toBe(true);
    }
  });
  it('luk が高いほど発見率が上がる', () => {
    const findRate = (luk: number) => {
      let found = 0;
      for (let seed = 0; seed < 500; seed++) if (rollSearch(seed, luk, 1) !== null) found++;
      return found / 500;
    };
    expect(findRate(60)).toBeGreaterThan(findRate(0));
  });
  it('発見率は上限を超えない (luk 極大でも maxFindChance 以下)', () => {
    let found = 0;
    for (let seed = 0; seed < 1000; seed++) if (rollSearch(seed, 999, 1) !== null) found++;
    expect(found / 1000).toBeLessThanOrEqual(SEARCH_TUNING.maxFindChance + 0.05);
  });
  it('tier3 では tier3 素材が出うる (地方連動)', () => {
    const t3 = new Set(MONSTERS.filter((m) => m.tier === 3).flatMap((m) => m.drops.map((d) => d.item)));
    let sawT3 = false;
    for (let seed = 0; seed < 500 && !sawT3; seed++) {
      const r = rollSearch(seed, 80, 3);
      if (r && t3.has(r)) sawT3 = true;
    }
    expect(sawT3).toBe(true);
  });
});
