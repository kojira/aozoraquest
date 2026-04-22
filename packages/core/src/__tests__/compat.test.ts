import { describe, expect, test } from 'vitest';
import {
  COMPLEMENTARITY_WEIGHT,
  SIMILARITY_WEIGHT,
  complementarity,
  resonance,
  resonanceLabel,
  resonanceTimelineScore,
  similarity,
} from '../compat.js';
import type { StatArray } from '../types.js';

describe('similarity', () => {
  test('identical → 1', () => {
    const v: StatArray = [20, 30, 10, 25, 15];
    expect(similarity(v, v)).toBeCloseTo(1.0);
  });

  test('opposing → clipped to 0', () => {
    const a: StatArray = [50, 10, 10, 10, 20];
    const b: StatArray = [10, 50, 10, 20, 10];
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0);
  });
});

describe('complementarity', () => {
  test('all axes within [10, 25] → 1.0', () => {
    const a: StatArray = [10, 10, 10, 10, 10];
    const b: StatArray = [25, 25, 25, 25, 25];
    const diff = b.map((x, i) => Math.abs(x - a[i]!));
    expect(diff.every(d => d >= 10 && d <= 25)).toBe(true);
    expect(complementarity(a, b)).toBeCloseTo(1.0);
  });

  test('identical → 0', () => {
    const v: StatArray = [20, 20, 20, 20, 20];
    expect(complementarity(v, v)).toBe(0);
  });

  test('too different (>25) → 0 for those axes', () => {
    const a: StatArray = [0, 0, 0, 0, 0];
    const b: StatArray = [50, 50, 50, 50, 50];
    expect(complementarity(a, b)).toBe(0);
  });
});

describe('resonance (archetype なしフォールバック)', () => {
  test('archetype 無しでも pairRelation は undefined、score は 0-1 に calibrate', () => {
    const a: StatArray = [20, 20, 20, 20, 20];
    const b: StatArray = [35, 20, 20, 15, 10];
    const r = resonance(a, b);
    expect(r.pairRelation).toBeUndefined();
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    // 生成式そのものではなく calibrate 後の値なので raw 直値とは一致しない
    const raw = r.similarity * SIMILARITY_WEIGHT + r.complementarity * COMPLEMENTARITY_WEIGHT;
    expect(r.score).toBeGreaterThanOrEqual(raw); // 低域は持ち上がる想定
  });

  test('identical (archetype 無し) → similarity=1, complementarity=0', () => {
    const v: StatArray = [20, 25, 15, 30, 10];
    const r = resonance(v, v);
    expect(r.similarity).toBeCloseTo(1);
    expect(r.complementarity).toBe(0);
  });
});

describe('resonance (archetype 付き)', () => {
  test('archetype を渡すと pairRelation が入る', () => {
    const v: StatArray = [25, 14, 10, 37, 14];
    const r = resonance(v, v, 'sage', 'sage');
    expect(r.pairRelation?.category).toBe('identity');
  });

  test('双対ペア (sage Ni/Te と performer Se/Fi) は pairRelation.category = duality', () => {
    const a: StatArray = [25, 14, 10, 37, 14];
    const b: StatArray = [20, 12, 30, 10, 28];
    const r = resonance(a, b, 'sage', 'performer');
    expect(r.pairRelation?.category).toBe('duality');
    // 双対は最高スコア帯 (恒等より高いはず)
    const identity = resonance(a, a, 'sage', 'sage');
    expect(r.score).toBeGreaterThan(identity.score);
  });
});

describe('resonanceLabel', () => {
  test.each([
    [0.9, '最高の相棒'],
    [0.7, 'よき仲間'],
    [0.5, '共に歩める'],
    [0.3, '違いが面白い'],
    [0.1, '異なる道を歩む者'],
  ])('score %f → label %s', (score, label) => {
    expect(resonanceLabel(score)).toBe(label);
  });
});

describe('resonanceTimelineScore', () => {
  test('just posted → full resonance', () => {
    expect(resonanceTimelineScore(0.7, 0)).toBeCloseTo(0.7);
  });

  test('48h old → half', () => {
    expect(resonanceTimelineScore(0.7, 48 * 3600000)).toBeCloseTo(0.35);
  });
});
