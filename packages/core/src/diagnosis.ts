import { DIAGNOSIS_TOP_N } from './embedding-config.js';
import { archetypeFromFunctionPair } from './jobs.js';
import { STATS, type Archetype, type CogFunction, type CognitiveScores, type Confidence, type DiagnosisResult, type Stat, type StatVector } from './types.js';

/**
 * 認知機能 → RPG ステータス合成係数 (04-diagnosis.md §合成係数)。
 * 各行の合計は 1.0 (データ整合性テストで検証済み)。
 */
export const COGNITIVE_TO_RPG: Record<CogFunction, Record<Stat, number>> = {
  Ni: { atk: 0.0, def: 0.1, agi: 0.0, int: 0.8, luk: 0.1 },
  Ne: { atk: 0.0, def: 0.0, agi: 0.5, int: 0.0, luk: 0.5 },
  Si: { atk: 0.1, def: 0.8, agi: 0.0, int: 0.1, luk: 0.0 },
  Se: { atk: 0.3, def: 0.0, agi: 0.7, int: 0.0, luk: 0.0 },
  Ti: { atk: 0.0, def: 0.1, agi: 0.1, int: 0.8, luk: 0.0 },
  Te: { atk: 0.8, def: 0.0, agi: 0.0, int: 0.2, luk: 0.0 },
  Fi: { atk: 0.0, def: 0.5, agi: 0.0, int: 0.0, luk: 0.5 },
  Fe: { atk: 0.0, def: 0.3, agi: 0.0, int: 0.0, luk: 0.7 },
};

/** コサイン類似度 (正規化済みベクトル前提、内積と等価) */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

/**
 * プロトタイプ群に対する Top-N 平均類似度スコア。
 * 04-diagnosis.md §処理 の top3Avg 相当。
 */
export function topNAverage(
  vec: Float32Array | number[],
  prototypes: readonly (Float32Array | number[])[],
  topN: number = DIAGNOSIS_TOP_N,
): number {
  if (prototypes.length === 0) return 0;
  const sims = prototypes.map(p => cosineSimilarity(vec, p)).sort((a, b) => b - a);
  const top = sims.slice(0, Math.min(topN, sims.length));
  return top.reduce((a, b) => a + b, 0) / top.length;
}

/**
 * 認知機能スコア正規化: 最大値を 100 にスケール。
 */
export function normalizeCognitive(scores: CognitiveScores): CognitiveScores {
  const max = Math.max(...Object.values(scores));
  if (max === 0) {
    return { Ni: 0, Ne: 0, Si: 0, Se: 0, Ti: 0, Te: 0, Fi: 0, Fe: 0 };
  }
  const out = {} as CognitiveScores;
  for (const k of Object.keys(scores) as CogFunction[]) {
    out[k] = Math.round((scores[k] / max) * 100);
  }
  return out;
}

/**
 * 認知機能スコアから RPG ステータスへ合成 (04-diagnosis.md §合成式)。
 * 出力は合計 100 で正規化済み。
 */
export function cognitiveToRpg(scores: CognitiveScores): StatVector {
  const rpg: StatVector = { atk: 0, def: 0, agi: 0, int: 0, luk: 0 };
  for (const fn of Object.keys(scores) as CogFunction[]) {
    const score = scores[fn];
    const coef = COGNITIVE_TO_RPG[fn];
    for (const stat of STATS) {
      rpg[stat] += score * coef[stat];
    }
  }
  const total = STATS.reduce((s, k) => s + rpg[k], 0);
  if (total === 0) return { atk: 20, def: 20, agi: 20, int: 20, luk: 20 };
  const out = {} as StatVector;
  for (const s of STATS) out[s] = Math.round((rpg[s] / total) * 100);
  return out;
}

/** アーキタイプ判定 (トップ 2 ペアから) */
export function determineArchetype(scores: CognitiveScores): { archetype: Archetype | null; top2: [CogFunction, CogFunction]; top3: [CogFunction, CogFunction, CogFunction] } {
  const sorted = (Object.entries(scores) as [CogFunction, number][])
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0]);
  const top2 = [sorted[0]!, sorted[1]!] as [CogFunction, CogFunction];
  const top3 = [sorted[0]!, sorted[1]!, sorted[2]!] as [CogFunction, CogFunction, CogFunction];
  let archetype = archetypeFromFunctionPair(top2[0], top2[1]);
  if (!archetype) {
    // 無効ペア (Ni×Se など) → 3 位まで試す
    archetype = archetypeFromFunctionPair(top2[0], top3[2]);
    if (!archetype) archetype = archetypeFromFunctionPair(top2[1], top3[2]);
  }
  return { archetype, top2, top3 };
}

/** 信頼度判定 (04-diagnosis.md §信頼度) */
export function computeConfidence(postCount: number, scores: CognitiveScores): Confidence {
  if (postCount < 50) return 'insufficient';
  const sorted = Object.values(scores).sort((a, b) => b - a);
  const gap1to2 = (sorted[0] ?? 0) - (sorted[1] ?? 0);
  const gap2to3 = (sorted[1] ?? 0) - (sorted[2] ?? 0);
  if (gap1to2 < 5 || gap2to3 < 5) return 'ambiguous';
  if (postCount < 100) return 'low';
  if (gap1to2 < 10) return 'medium';
  return 'high';
}

/**
 * 全体の診断ロジックを純粋関数で (埋め込みは呼び出し側で行う)。
 *
 * @param postEmbeddings 投稿 N 件の埋め込みベクトル
 * @param cognitivePrototypes 各認知機能のプロトタイプ埋め込み (8 機能)
 * @param postCount 入力投稿数 (信頼度計算に使う)
 */
export function diagnose(
  postEmbeddings: readonly Float32Array[],
  cognitivePrototypes: Record<CogFunction, readonly Float32Array[]>,
  postCount: number,
  now: Date = new Date(),
): DiagnosisResult | { insufficient: true; postCount: number } {
  if (postCount < 50) {
    return { insufficient: true, postCount };
  }

  // 各投稿 × 各機能のスコア (Top-N 平均)
  const scoreAcc: CognitiveScores = { Ni: 0, Ne: 0, Si: 0, Se: 0, Ti: 0, Te: 0, Fi: 0, Fe: 0 };
  const fnKeys = Object.keys(cognitivePrototypes) as CogFunction[];
  for (const vec of postEmbeddings) {
    for (const fn of fnKeys) {
      scoreAcc[fn] += topNAverage(vec, cognitivePrototypes[fn]);
    }
  }
  // 投稿数で平均化
  const avg = {} as CognitiveScores;
  for (const fn of fnKeys) avg[fn] = scoreAcc[fn] / postEmbeddings.length;

  const normalized = normalizeCognitive(avg);
  const rpgStats = cognitiveToRpg(normalized);
  const { archetype } = determineArchetype(normalized);
  const confidence = computeConfidence(postCount, normalized);

  return {
    archetype: archetype ?? 'sage', // フォールバック (ambiguous 時に補助的に使う)
    rpgStats,
    cognitiveScores: normalized,
    confidence,
    analyzedPostCount: postCount,
    analyzedAt: now.toISOString(),
  };
}
