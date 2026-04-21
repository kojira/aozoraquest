import type { StatArray } from './types.js';

/**
 * 共鳴度 = 類似度 × 0.6 + 相補性 × 0.4 (05-compatibility.md)
 *
 * 重み 0.6 / 0.4 は仮置き。11-validation.md §実験 3 で β 運用データから再校正予定。
 */
export const SIMILARITY_WEIGHT = 0.6;
export const COMPLEMENTARITY_WEIGHT = 0.4;

export const COMPLEMENT_GAP_MIN = 10;
export const COMPLEMENT_GAP_MAX = 25;

/** ピアソン相関 (0 未満は 0 にクリップ) */
export function similarity(a: StatArray, b: StatArray): number {
  const aMean = mean(a);
  const bMean = mean(b);
  const aC = a.map(v => v - aMean);
  const bC = b.map(v => v - bMean);
  const dot = aC.reduce((s, v, i) => s + v * bC[i]!, 0);
  const aMag = Math.hypot(...aC);
  const bMag = Math.hypot(...bC);
  if (aMag === 0 || bMag === 0) return 0;
  return Math.max(0, dot / (aMag * bMag));
}

/**
 * 相補性スコア: 各軸の差が [MIN, MAX] なら +0.2、最大 1.0 にクリップ。
 * 5 軸すべてが境界内なら 1.0、1 軸でも境界外ならその分減る。
 */
export function complementarity(a: StatArray, b: StatArray): number {
  let score = 0;
  for (let i = 0; i < 5; i++) {
    const diff = Math.abs(a[i]! - b[i]!);
    if (diff >= COMPLEMENT_GAP_MIN && diff <= COMPLEMENT_GAP_MAX) {
      score += 0.2;
    }
  }
  return Math.min(score, 1);
}

export interface ResonanceDetail {
  score: number;
  similarity: number;
  complementarity: number;
}

export function resonance(a: StatArray, b: StatArray): ResonanceDetail {
  const sim = similarity(a, b);
  const comp = complementarity(a, b);
  const score = sim * SIMILARITY_WEIGHT + comp * COMPLEMENTARITY_WEIGHT;
  return { score, similarity: sim, complementarity: comp };
}

/** 共鳴度の言語ラベル (05-compatibility.md §共鳴度の意味付け) */
export function resonanceLabel(score: number): string {
  if (score >= 0.8) return '最高の相棒';
  if (score >= 0.6) return 'よき仲間';
  if (score >= 0.4) return '共に歩める';
  if (score >= 0.2) return '違いが面白い';
  return '異なる道を歩む者';
}

/**
 * 共鳴タイムラインのランク付けスコア。
 * resonance × exp(-age_hours / HALF_LIFE_HOURS) でフレッシュネス考慮。
 * 仮置き 48h (11-validation.md §実験 7)。
 */
export const FRESHNESS_HALF_LIFE_HOURS = 48;

export function resonanceTimelineScore(resonanceScore: number, postAgeMs: number): number {
  const ageHours = postAgeMs / 3600000;
  const freshness = Math.exp((-ageHours * Math.LN2) / FRESHNESS_HALF_LIFE_HOURS);
  return resonanceScore * freshness;
}

// ─── utils ───
function mean(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
