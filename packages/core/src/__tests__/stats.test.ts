import { describe, expect, test } from 'vitest';
import {
  DAILY_CAP_PER_ACTION_TYPE,
  addStats,
  applyFloor,
  capDailyActions,
  computeStats,
  currentStatsRaw,
  normalizeStats,
  scaleStats,
  sortStatsByAbsGap,
  statGap,
  zeroStats,
} from '../stats.js';
import type { Action } from '../types.js';

describe('basic ops', () => {
  test('zero + anything = identity', () => {
    const v = { atk: 10, def: 20, agi: 30, int: 40, luk: 50 };
    expect(addStats(zeroStats(), v)).toEqual(v);
  });

  test('scale by 0 = zero', () => {
    expect(scaleStats({ atk: 5, def: 5, agi: 5, int: 5, luk: 5 }, 0)).toEqual(zeroStats());
  });
});

describe('currentStatsRaw with decay', () => {
  test('recent action contributes near full weight', () => {
    const now = 1_000_000_000_000;
    const action: Action = { type: 'x', timestamp: now - 1000, weights: { atk: 100, def: 0, agi: 0, int: 0, luk: 0 } };
    const result = currentStatsRaw([action], now);
    expect(result.atk).toBeCloseTo(100, 0);
  });

  test('60 days old → half', () => {
    const now = Date.now();
    const sixtyDaysAgo = now - 60 * 86400000;
    const action: Action = { type: 'x', timestamp: sixtyDaysAgo, weights: { atk: 100, def: 0, agi: 0, int: 0, luk: 0 } };
    const result = currentStatsRaw([action], now);
    expect(result.atk).toBeCloseTo(50, 0);
  });
});

describe('normalizeStats', () => {
  test('sums to 100', () => {
    const v = { atk: 3, def: 1, agi: 4, int: 1, luk: 1 };
    const n = normalizeStats(v);
    const total = n.atk + n.def + n.agi + n.int + n.luk;
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(2); // rounding
  });

  test('all zero → even distribution 20 each', () => {
    expect(normalizeStats(zeroStats())).toEqual({ atk: 20, def: 20, agi: 20, int: 20, luk: 20 });
  });
});

describe('applyFloor', () => {
  test('values below floor become floor', () => {
    const v = { atk: 2, def: 100, agi: 0, int: 50, luk: 3 };
    const f = applyFloor(v);
    expect(f.atk).toBe(5);
    expect(f.def).toBe(100);
    expect(f.agi).toBe(5);
    expect(f.luk).toBe(5);
  });
});

describe('capDailyActions', () => {
  test('caps actions exceeding DAILY_CAP_PER_ACTION_TYPE', () => {
    const base = Date.parse('2026-04-01T00:00:00Z');
    const actions: Action[] = Array.from({ length: DAILY_CAP_PER_ACTION_TYPE + 2 }, (_, i) => ({
      type: 'opinion_post',
      timestamp: base + i * 1000,
      weights: { atk: 3, def: 0, agi: 0, int: 0, luk: 0 },
    }));
    const capped = capDailyActions(actions);
    const effectiveAtk = capped.reduce((s, a) => s + a.weights.atk, 0);
    expect(effectiveAtk).toBe(DAILY_CAP_PER_ACTION_TYPE * 3);
  });

  test('different types counted separately', () => {
    const base = Date.parse('2026-04-01T00:00:00Z');
    const actions: Action[] = [];
    for (let i = 0; i < 10; i++) {
      actions.push({ type: 'opinion_post', timestamp: base + i, weights: { atk: 1, def: 0, agi: 0, int: 0, luk: 0 } });
      actions.push({ type: 'analysis_post', timestamp: base + i, weights: { atk: 0, def: 0, agi: 0, int: 1, luk: 0 } });
    }
    const capped = capDailyActions(actions);
    const atkSum = capped.reduce((s, a) => s + a.weights.atk, 0);
    const intSum = capped.reduce((s, a) => s + a.weights.int, 0);
    expect(atkSum).toBe(DAILY_CAP_PER_ACTION_TYPE);
    expect(intSum).toBe(DAILY_CAP_PER_ACTION_TYPE);
  });
});

describe('computeStats end-to-end', () => {
  test('empty actions → even distribution', () => {
    const result = computeStats([]);
    expect(result).toEqual({ atk: 20, def: 20, agi: 20, int: 20, luk: 20 });
  });

  test('pipeline is deterministic', () => {
    const now = Date.now();
    const actions: Action[] = [
      { type: 'opinion_post', timestamp: now, weights: { atk: 3, def: 0, agi: 0, int: 0, luk: 0 } },
    ];
    expect(computeStats(actions, now)).toEqual(computeStats(actions, now));
  });
});

describe('statGap and sort', () => {
  test('sortStatsByAbsGap orders by |gap|', () => {
    const gap = { atk: 5, def: -20, agi: 0, int: 10, luk: -3 };
    const sorted = sortStatsByAbsGap(gap);
    expect(sorted[0]).toBe('def');
    expect(sorted[1]).toBe('int');
  });
});
