import { COMPATIBILITY_WEIGHTS, COMPLEMENT_GAP_RANGE } from './tuning.js';
import type { StatArray } from './types.js';

// 後方互換の別名 (以前の API で参照されていた名称)
export const SIMILARITY_WEIGHT = COMPATIBILITY_WEIGHTS.similarity;
export const COMPLEMENTARITY_WEIGHT = COMPATIBILITY_WEIGHTS.complementarity;
export const COMPLEMENT_GAP_MIN = COMPLEMENT_GAP_RANGE.min;
export const COMPLEMENT_GAP_MAX = COMPLEMENT_GAP_RANGE.max;

/**
 * 形の類似度 (ピアソン相関)。0 未満は 0 にクリップ。
 * Robins et al. (2000) 等では性格類似性と関係満足度に r ≈ 0.22 の
 * 中程度の相関が報告されており、主要な相性予測子として扱う。
 */
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
 * 相補性スコア: 各軸の差が [min, max] のスイートスポットなら perAxisScore 加算。
 * 5 軸全てが境界内で最大 1.0。差が小さすぎる (= 似すぎ) or 大きすぎる (= 断絶) は 0。
 */
export function complementarity(a: StatArray, b: StatArray): number {
  const { min, max, perAxisScore } = COMPLEMENT_GAP_RANGE;
  let score = 0;
  for (let i = 0; i < 5; i++) {
    const diff = Math.abs(a[i]! - b[i]!);
    if (diff >= min && diff <= max) score += perAxisScore;
  }
  return Math.min(score, 1);
}

export interface ResonanceDetail {
  /** 総合スコア (0-1)。大きいほど「相性が良い」。 */
  score: number;
  similarity: number;
  complementarity: number;
}

/**
 * 共鳴度 (相性) を「類似性 + 相補性」の 2 軸で評価する。
 * 重み (tuning.COMPATIBILITY_WEIGHTS) と併せて根拠は tuning.ts 冒頭を参照。
 */
export function resonance(a: StatArray, b: StatArray): ResonanceDetail {
  const sim = similarity(a, b);
  const comp = complementarity(a, b);
  const w = COMPATIBILITY_WEIGHTS;
  const score = sim * w.similarity + comp * w.complementarity;
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
