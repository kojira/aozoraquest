import { COMPATIBILITY_WEIGHTS, COMPLEMENT_GAP_RANGE } from './tuning.js';
import type { StatArray } from './types.js';

// 後方互換の別名 (以前の API で参照されていた名称)
export const SIMILARITY_WEIGHT = COMPATIBILITY_WEIGHTS.similarity;
export const COMPLEMENTARITY_WEIGHT = COMPATIBILITY_WEIGHTS.complementarity;
export const COMPLEMENT_GAP_MIN = COMPLEMENT_GAP_RANGE.min;
export const COMPLEMENT_GAP_MAX = COMPLEMENT_GAP_RANGE.max;

/**
 * 形の類似度 (ピアソン相関)。0 未満は 0 にクリップ。
 * 「似ている」だけで相性が高くはならないので、resonance の寄与は小さい重みに抑える。
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

/**
 * 2 人で合わせたときのカバレッジ: 軸ごとの max(a[i], b[i]) の合計を正規化。
 * 2 人が全く同じ形 → 0 (合わせても自分ひとり分しかカバーできない)。
 * 2 人が完全に相補的 (軸ごとにどちらかに全振り) → 1 (全軸で強みを持ち寄れる)。
 *
 * 理論上界は 2 人の合計 = 200、identical の場合は 100 に一致するので、
 * coverage = (jointSum - 100) / 100 で 0-1 にマップする。
 */
export function jointCoverage(a: StatArray, b: StatArray): number {
  let jointSum = 0;
  for (let i = 0; i < 5; i++) jointSum += Math.max(a[i]!, b[i]!);
  return Math.max(0, Math.min(1, (jointSum - 100) / 100));
}

export interface ResonanceDetail {
  /** 総合スコア (0-1)。大きいほど「相性が良い」。 */
  score: number;
  similarity: number;
  complementarity: number;
  /** 2 人合わせたときの役割カバレッジ。 */
  jointCoverage: number;
}

/**
 * 共鳴度 (相性) を 3 軸で評価する。
 * - similarity  : 形が似ているか (低めの重み。似てるだけでは相性ではない)
 * - complementarity : 軸ごとの差が適度か (大きすぎず小さすぎず)
 * - jointCoverage   : 2 人で合わせたときに強みを補い合えるか
 */
export function resonance(a: StatArray, b: StatArray): ResonanceDetail {
  const sim = similarity(a, b);
  const comp = complementarity(a, b);
  const cov = jointCoverage(a, b);
  const w = COMPATIBILITY_WEIGHTS;
  const score = sim * w.similarity + comp * w.complementarity + cov * w.jointCoverage;
  return { score, similarity: sim, complementarity: comp, jointCoverage: cov };
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
