import { describe, expect, test } from 'vitest';
import {
  COGNITIVE_TO_RPG,
  cognitiveToRpg,
  computeConfidence,
  computePostWeights,
  cosineSimilarity,
  determineArchetype,
  diagnose,
  normalizeCognitive,
  topNAverage,
} from '../diagnosis.js';
import type { CogFunction } from '../types.js';
import { COGNITIVE_FUNCTIONS, STATS, type CognitiveScores } from '../types.js';

describe('COGNITIVE_TO_RPG', () => {
  test('each row sums to ~1.0', () => {
    for (const fn of COGNITIVE_FUNCTIONS) {
      const sum = STATS.reduce((s, stat) => s + COGNITIVE_TO_RPG[fn][stat], 0);
      expect(sum).toBeCloseTo(1.0, 2);
    }
  });
});

describe('cosineSimilarity', () => {
  test('identical normalized → 1', () => {
    const v = new Float32Array([0.6, 0.8]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  test('orthogonal → 0', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe('topNAverage', () => {
  test('takes top 3 of similarities', () => {
    const v = new Float32Array([1, 0]);
    const prototypes = [
      new Float32Array([1, 0]),       // 1.0
      new Float32Array([0.9, 0.1]),   // ~0.9
      new Float32Array([0.1, 0.9]),   // ~0.1
      new Float32Array([0, 1]),       // 0
    ];
    const avg = topNAverage(v, prototypes, 3);
    // (1.0 + 0.9 + 0.1) / 3 = 0.666...
    expect(avg).toBeCloseTo((1.0 + prototypes[1]![0]! + prototypes[2]![0]!) / 3);
  });
});

describe('normalizeCognitive', () => {
  test('max scaled to 100', () => {
    const scores: CognitiveScores = { Ni: 0.5, Ne: 0.25, Si: 0.125, Se: 0.0625, Ti: 0, Te: 0, Fi: 0, Fe: 0 };
    const n = normalizeCognitive(scores);
    expect(n.Ni).toBe(100);
    expect(n.Ne).toBe(50);
  });
});

describe('cognitiveToRpg', () => {
  test('pure Te → dominated by atk', () => {
    const scores: CognitiveScores = { Ni: 0, Ne: 0, Si: 0, Se: 0, Ti: 0, Te: 100, Fi: 0, Fe: 0 };
    const rpg = cognitiveToRpg(scores);
    expect(rpg.atk).toBe(80);
    expect(rpg.int).toBe(20);
    expect(rpg.def + rpg.agi + rpg.luk).toBe(0);
  });

  test('even distribution → balanced rpg', () => {
    const scores: CognitiveScores = { Ni: 50, Ne: 50, Si: 50, Se: 50, Ti: 50, Te: 50, Fi: 50, Fe: 50 };
    const rpg = cognitiveToRpg(scores);
    const sum = STATS.reduce((s, k) => s + rpg[k], 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(2);
  });
});

describe('determineArchetype', () => {
  test('Ni > Te → sage', () => {
    const scores: CognitiveScores = { Ni: 100, Te: 80, Ti: 20, Ne: 10, Si: 5, Se: 5, Fi: 5, Fe: 5 };
    expect(determineArchetype(scores).archetype).toBe('sage');
  });

  test('Fi > Ne → poet', () => {
    const scores: CognitiveScores = { Fi: 100, Ne: 80, Ni: 30, Si: 10, Ti: 10, Te: 10, Se: 10, Fe: 10 };
    expect(determineArchetype(scores).archetype).toBe('poet');
  });
});

describe('computeConfidence', () => {
  test('postCount < 50 → insufficient', () => {
    expect(computeConfidence(30, { Ni: 50, Ne: 40, Si: 30, Se: 20, Ti: 10, Te: 5, Fi: 3, Fe: 1 })).toBe('insufficient');
  });

  test('large gap, many posts → high', () => {
    expect(computeConfidence(150, { Ni: 100, Te: 50, Ti: 30, Ne: 10, Si: 5, Se: 5, Fi: 5, Fe: 5 })).toBe('high');
  });

  test('small gap → ambiguous', () => {
    expect(computeConfidence(150, { Ni: 100, Te: 97, Ti: 95, Ne: 90, Si: 80, Se: 70, Fi: 60, Fe: 50 })).toBe('ambiguous');
  });
});

describe('diagnose (centering の効果)', () => {
  // 各機能ごとに「その機能の軸に 1.0、他は 0」の単位ベクトルを 1 本ずつ
  // プロトタイプにする。ポストも同じ形式 (one-hot on 1 軸)。
  // これで「post 軸 = proto 軸」なら cos = 1、違えば cos = 0 になる。
  const fns: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];
  function oneHot(idx: number): Float32Array {
    const v = new Float32Array(8);
    v[idx] = 1;
    return v;
  }
  const protos = {} as Record<CogFunction, Float32Array[]>;
  fns.forEach((fn, i) => { protos[fn] = [oneHot(i)]; });

  test('全投稿が Fi 寄りなら Fi が top-1 になる', () => {
    const fiIdx = fns.indexOf('Fi');
    const posts: Float32Array[] = [];
    for (let i = 0; i < 60; i++) posts.push(oneHot(fiIdx));
    const r = diagnose(posts, protos, 60);
    expect('insufficient' in r).toBe(false);
    if ('archetype' in r) {
      expect(r.cognitiveScores.Fi).toBeGreaterThan(r.cognitiveScores.Ni);
      expect(r.cognitiveScores.Fi).toBeGreaterThan(r.cognitiveScores.Te);
    }
  });

  test('全投稿が Te 寄りなら Te が top-1 になる (Ni 偏りに引きずられない)', () => {
    const teIdx = fns.indexOf('Te');
    const posts: Float32Array[] = [];
    for (let i = 0; i < 60; i++) posts.push(oneHot(teIdx));
    const r = diagnose(posts, protos, 60);
    if ('archetype' in r) {
      expect(r.cognitiveScores.Te).toBeGreaterThan(r.cognitiveScores.Ni);
    }
  });
});

describe('computePostWeights', () => {
  test('timestamps 無しは全て 1', () => {
    expect(computePostWeights(undefined)).toEqual([]);
  });

  test('今から新しい投稿ほど重い', () => {
    const now = new Date('2026-04-21T12:00:00Z');
    const ts = [
      '2026-04-21T11:55:00Z', // 直前 → 1.0
      '2025-10-21T12:00:00Z', // 半年前 → 下限 0.25
    ];
    const w = computePostWeights(ts, now);
    expect(w[0]).toBeCloseTo(1.0, 2);
    expect(w[1]).toBeCloseTo(0.25, 2);
  });

  test('5 分以内のバーストは重みを 1/sqrt(group) に割る', () => {
    const now = new Date('2026-04-21T12:00:00Z');
    // 4 件が連投 (5 分以内)、1 件は離れている
    const ts = [
      '2026-04-21T11:58:00Z',
      '2026-04-21T11:58:30Z',
      '2026-04-21T11:59:00Z',
      '2026-04-21T11:59:30Z',
      '2026-04-21T10:00:00Z', // 2 時間前、単独
    ];
    const w = computePostWeights(ts, now);
    // 4 連投はそれぞれ 1/sqrt(4) = 0.5 倍されている (recency は直近なのでほぼ 1)
    const avgBurst = (w[0]! + w[1]! + w[2]! + w[3]!) / 4;
    expect(avgBurst).toBeLessThan(0.6);
    expect(avgBurst).toBeGreaterThan(0.45);
    // 単独投稿はバースト補正なし
    expect(w[4]).toBeGreaterThan(0.9);
  });
});
