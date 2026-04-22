import { archetypePairRelation, type ArchetypePairRelation } from './archetype-pair.js';
import { COMPATIBILITY_WEIGHTS, COMPLEMENT_GAP_RANGE } from './tuning.js';
import type { Archetype, StatArray } from './types.js';

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
  /** archetype ペアの関係カテゴリ (archetype 引数が渡されたときのみ入る)。 */
  pairRelation?: ArchetypePairRelation;
}

/**
 * 共鳴度 (相性) を計算する。
 * archetype を渡した場合: ペア関係カテゴリ (双対/鏡像/衝突 等) を主に、
 *   連続 stat 類似度 + 相補性で微調整する合成式。
 * archetype を渡さない場合: 2 軸 (類似 / 相補) のみでフォールバック。
 *
 * 各成分の「貢献点」が加算で 100 になるよう設計:
 *   気質ペア (baseScore normalised) * 0.60  → 最大 60 点
 *   共鳴 (similarity)               * 0.25  → 最大 25 点
 *   連携 (complementarity)          * 0.15  → 最大 15 点
 * 合計 100 点。双対 (baseScore 0.9) + sim 1.0 + comp 1.0 で理論 100%。
 * baseScore はカテゴリ最高値 0.9 を 1.0 にスケールしてから使う。
 */
export function resonance(
  a: StatArray,
  b: StatArray,
  archetypeA?: Archetype,
  archetypeB?: Archetype,
): ResonanceDetail {
  const sim = similarity(a, b);
  const comp = complementarity(a, b);
  const w = COMPATIBILITY_WEIGHTS;

  if (archetypeA && archetypeB) {
    const pair = archetypePairRelation(archetypeA, archetypeB);
    const basePart = (pair.baseScore / PAIR_BASE_MAX) * w.pairBase;
    const simPart = sim * w.statSimilarity;
    const compPart = comp * w.statComplement;
    const score = Math.min(1, Math.max(0, basePart + simPart + compPart));
    return {
      score,
      similarity: sim,
      complementarity: comp,
      pairRelation: pair,
    };
  }

  // archetype 無しフォールバック (2 軸)。この 2 つも合計 100 点スケールに揃える
  // (similarity 重み + complementarity 重み = 0.4 を 1.0 へリスケール)。
  const fallbackTotal = w.similarity + w.complementarity;
  const raw = (sim * w.similarity + comp * w.complementarity) / (fallbackTotal || 1);
  return {
    score: Math.min(1, Math.max(0, raw)),
    similarity: sim,
    complementarity: comp,
  };
}

/** archetype-pair.ts の baseScore 最大値 (duality)。バージョン互換のためここで定数化。 */
const PAIR_BASE_MAX = 0.9;

/**
 * UI 表示用: 生コンポーネントを「貢献点 (pts)」と「最大点」のペアで返す。
 * 合計は必ず 100 点満点に等しい。
 */
export interface ResonanceBreakdown {
  pair: { pts: number; max: number };
  similarity: { pts: number; max: number };
  complementarity: { pts: number; max: number };
  totalPts: number;
}

export function resonanceBreakdown(detail: ResonanceDetail): ResonanceBreakdown {
  const w = COMPATIBILITY_WEIGHTS;
  const baseNorm = detail.pairRelation ? detail.pairRelation.baseScore / PAIR_BASE_MAX : 0;
  // 生の contribution (float) と max
  const rawPair = detail.pairRelation ? baseNorm * w.pairBase * 100 : 0;
  const rawSim = detail.similarity * w.statSimilarity * 100;
  const rawComp = detail.complementarity * w.statComplement * 100;
  // 各 max
  const pairMax = detail.pairRelation ? Math.round(w.pairBase * 100) : 0;
  const simMax = Math.round(w.statSimilarity * 100);
  const compMax = Math.round(w.statComplement * 100);
  // 合計は detail.score (= 0-1 float) * 100 を丸めた値と一致させたい。
  // これを target として、大きい余り法 (Largest Remainder) で pts を割り振る。
  const targetTotal = Math.round(Math.min(1, Math.max(0, detail.score)) * 100);
  const pts = distributeWithTarget([rawPair, rawSim, rawComp], targetTotal);
  return {
    pair: { pts: pts[0]!, max: pairMax },
    similarity: { pts: pts[1]!, max: simMax },
    complementarity: { pts: pts[2]!, max: compMax },
    totalPts: targetTotal,
  };
}

/**
 * 各 raw 値に対して Math.floor を取り、不足分を小数部が大きい順に +1 する
 * (Largest Remainder / Hamilton method)。合計が target に一致する整数列を返す。
 */
function distributeWithTarget(raws: readonly number[], target: number): number[] {
  const floors = raws.map((r) => Math.max(0, Math.floor(r)));
  const sumFloor = floors.reduce((s, f) => s + f, 0);
  const deficit = Math.max(0, target - sumFloor);
  const remainders = raws
    .map((r, i) => ({ i, frac: Math.max(0, r) - Math.max(0, Math.floor(r)) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < deficit; k++) {
    const j = remainders[k % remainders.length]!.i;
    out[j]!++;
  }
  return out;
}

/** 共鳴度の言語ラベル (05-compatibility.md §共鳴度の意味付け) */
export function resonanceLabel(score: number): string {
  if (score >= 0.90) return '魂の片割れ';
  if (score >= 0.80) return '宿命の盟友';
  if (score >= 0.70) return '最高の相棒';
  if (score >= 0.55) return 'よき仲間';
  if (score >= 0.40) return '道連れの縁';
  if (score >= 0.25) return '違いが面白い';
  return '異なる道を歩む者';
}

/**
 * 共鳴タイムラインのランク付けスコア。
 * resonance × exp(-age_hours / HALF_LIFE_HOURS) でフレッシュネス考慮。
 * 半減期は tuning.RESONANCE_FRESHNESS_HALF_LIFE_HOURS。
 */
import { RESONANCE_FRESHNESS_HALF_LIFE_HOURS } from './tuning.js';

export const FRESHNESS_HALF_LIFE_HOURS = RESONANCE_FRESHNESS_HALF_LIFE_HOURS;

export function resonanceTimelineScore(resonanceScore: number, postAgeMs: number): number {
  const ageHours = postAgeMs / 3600000;
  const freshness = Math.exp((-ageHours * Math.LN2) / FRESHNESS_HALF_LIFE_HOURS);
  return resonanceScore * freshness;
}

// ─── utils ───
function mean(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
