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

describe('resonance', () => {
  test('formula = 0.6*sim + 0.4*comp', () => {
    const a: StatArray = [20, 20, 20, 20, 20];
    const b: StatArray = [35, 20, 20, 15, 10];
    const r = resonance(a, b);
    expect(r.score).toBeCloseTo(r.similarity * SIMILARITY_WEIGHT + r.complementarity * COMPLEMENTARITY_WEIGHT);
  });

  test('identical → similarity = 1, comp = 0, score = 0.6', () => {
    const v: StatArray = [20, 25, 15, 30, 10];
    const r = resonance(v, v);
    expect(r.similarity).toBeCloseTo(1);
    expect(r.complementarity).toBe(0);
    expect(r.score).toBeCloseTo(0.6);
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
