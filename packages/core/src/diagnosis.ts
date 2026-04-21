import { DIAGNOSIS_TOP_N } from './embedding-config.js';
import { JOBS } from './jobs.js';
import { ARCHETYPE_FIT_WEIGHTS, DIAGNOSIS_CONFIDENCE_THRESHOLDS, DIAGNOSIS_MIN_POST_COUNT, DIAGNOSIS_TIME_WEIGHTING } from './tuning.js';
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
 * 認知機能スコア正規化: min-max で 0-100 にリスケール。
 *
 * Ruri-v3 の類似度は全体的に高めに分布する (0.75-0.9 帯に固まる) ため、
 * 最大値のみで割るとトップ以外が 80-90 に並び差が見えない。8 軸中の
 * 最小を 0、最大を 100 にシフトするとシルエットが明確になる。
 *
 * 入力値が全て同じ場合は全て 0 を返す (分類不能)。
 * 全て 0 (または負) の場合も 0 埋めフォールバック。
 */
export function normalizeCognitive(scores: CognitiveScores): CognitiveScores {
  const vals = Object.values(scores);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV;
  if (range === 0) {
    return { Ni: 0, Ne: 0, Si: 0, Se: 0, Ti: 0, Te: 0, Fi: 0, Fe: 0 };
  }
  const out = {} as CognitiveScores;
  for (const k of Object.keys(scores) as CogFunction[]) {
    out[k] = Math.round(((scores[k] - minV) / range) * 100);
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

// 文字反転テーブル: T↔F、N↔S、i↔e
const OPPOSITE_LETTER: Record<string, string> = { N: 'S', S: 'N', T: 'F', F: 'T' };
const OPPOSITE_ATTITUDE: Record<string, string> = { i: 'e', e: 'i' };

/**
 * 気質スタックの 4 層を (dom, aux) から展開する。
 * 例: dom=Ni, aux=Te のとき
 *   tertiary = Fi  (aux の letter を反転、attitude は dom と同じ)
 *   inferior = Se  (dom の letter と attitude を両方反転)
 */
function temperamentStack(dom: CogFunction, aux: CogFunction): { tertiary: CogFunction; inferior: CogFunction } {
  const domLetter = dom[0]!;
  const domAtt = dom[1]!;
  const auxLetter = aux[0]!;
  const tertiary = (OPPOSITE_LETTER[auxLetter]! + domAtt) as CogFunction;
  const inferior = (OPPOSITE_LETTER[domLetter]! + OPPOSITE_ATTITUDE[domAtt]!) as CogFunction;
  return { tertiary, inferior };
}

/**
 * 全 16 archetype に対して気質スタック適合度を計算し argmax。
 * フォールバック不要 — 必ず測定された scores に最も合う archetype を返す。
 */
export function determineArchetype(scores: CognitiveScores): { archetype: Archetype; top2: [CogFunction, CogFunction]; top3: [CogFunction, CogFunction, CogFunction]; fitScore: number } {
  const sorted = (Object.entries(scores) as [CogFunction, number][])
    .sort((a, b) => b[1] - a[1])
    .map((e) => e[0]);
  const top2 = [sorted[0]!, sorted[1]!] as [CogFunction, CogFunction];
  const top3 = [sorted[0]!, sorted[1]!, sorted[2]!] as [CogFunction, CogFunction, CogFunction];

  const w = ARCHETYPE_FIT_WEIGHTS;
  let best: { archetype: Archetype; fit: number } | null = null;
  for (const j of JOBS) {
    const { tertiary, inferior } = temperamentStack(j.dominantFunction, j.auxiliaryFunction);
    const fit =
      w.dom * scores[j.dominantFunction] +
      w.aux * scores[j.auxiliaryFunction] +
      w.tertiary * scores[tertiary] +
      w.inferior * scores[inferior];
    if (!best || fit > best.fit) best = { archetype: j.id, fit };
  }
  return { archetype: best!.archetype, top2, top3, fitScore: best!.fit };
}

/** 信頼度判定 (04-diagnosis.md §信頼度) */
export function computeConfidence(postCount: number, scores: CognitiveScores): Confidence {
  if (postCount < DIAGNOSIS_MIN_POST_COUNT) return 'insufficient';
  const sorted = Object.values(scores).sort((a, b) => b - a);
  const gap1to2 = (sorted[0] ?? 0) - (sorted[1] ?? 0);
  const gap2to3 = (sorted[1] ?? 0) - (sorted[2] ?? 0);
  const th = DIAGNOSIS_CONFIDENCE_THRESHOLDS;
  if (gap1to2 < th.minGap || gap2to3 < th.minGap) return 'ambiguous';
  if (postCount < th.lowPostCount) return 'low';
  if (gap1to2 < th.mediumGap) return 'medium';
  return 'high';
}

/**
 * 各投稿の重みを決める (時間軸考慮)。
 *   - 新しい投稿ほど重い (30 日で線形に半減する、180 日で 1/4)。
 *   - 5 分以内の連投 (burst) はひとまとまりの気分で「重複」しやすいので、
 *     グループ内で重みを割って加算の寄与を平準化する。
 * 時刻が与えられない場合は全て 1.0 (従来挙動)。
 */
export function computePostWeights(timestamps?: readonly string[], now: Date = new Date()): number[] {
  if (!timestamps || timestamps.length === 0) return [];
  const { burstWindowMs, halfLifeMs, decayAmplitude, minRecencyWeight } = DIAGNOSIS_TIME_WEIGHTING;
  const n = timestamps.length;
  const weights = new Array<number>(n).fill(1);

  const times = timestamps.map((t) => {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : NaN;
  });
  const nowMs = now.getTime();

  // 1) recency 減衰: 古いほど軽い (halfLifeMs 経過で 1-decayAmplitude、下限 minRecencyWeight)
  for (let i = 0; i < n; i++) {
    const t = times[i]!;
    if (!Number.isFinite(t)) continue;
    const ageMs = Math.max(0, nowMs - t);
    const w = Math.max(minRecencyWeight, 1 - decayAmplitude * (ageMs / halfLifeMs));
    weights[i] = w;
  }

  // 2) バースト平準化: burstWindowMs 以内で連続する投稿群は
  //    各メンバーの重みを 1/sqrt(groupSize) に割る (連投の連呼を抑制)。
  const order = times
    .map((t, i) => ({ t, i }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  let g: number[] = [];
  const flush = () => {
    if (g.length <= 1) return;
    const factor = 1 / Math.sqrt(g.length);
    for (const i of g) weights[i] = (weights[i] ?? 1) * factor;
  };
  for (let k = 0; k < order.length; k++) {
    const cur = order[k]!;
    if (g.length === 0) { g = [cur.i]; continue; }
    const prevT = order[k - 1]!.t;
    if (cur.t - prevT <= burstWindowMs) g.push(cur.i);
    else { flush(); g = [cur.i]; }
  }
  flush();
  return weights;
}

/**
 * 全体の診断ロジックを純粋関数で (埋め込みは呼び出し側で行う)。
 *
 * @param postEmbeddings 投稿 N 件の埋め込みベクトル
 * @param cognitivePrototypes 各認知機能のプロトタイプ埋め込み (8 機能)
 * @param postCount 入力投稿数 (信頼度計算に使う)
 * @param options.timestamps 各投稿の createdAt (ISO)。与えると時間軸重み付けを適用
 */
export function diagnose(
  postEmbeddings: readonly Float32Array[],
  cognitivePrototypes: Record<CogFunction, readonly Float32Array[]>,
  postCount: number,
  now: Date = new Date(),
  options: { timestamps?: readonly string[] } = {},
): DiagnosisResult | { insufficient: true; postCount: number } {
  if (postCount < DIAGNOSIS_MIN_POST_COUNT) {
    return { insufficient: true, postCount };
  }

  const weights = options.timestamps
    ? computePostWeights(options.timestamps, now)
    : new Array<number>(postEmbeddings.length).fill(1);

  // 各投稿について 8 機能スコアを取り、per-post で平均を引いて中心化してから加算。
  // Ruri の類似度分布が全体的に高いため、生スコアをそのまま足すと「最も一般的な
  // 機能プロトタイプ」が常に勝ってしまう (実際 Ni が全ユーザーで 1 位になる
  // 現象が出ていた)。中心化すれば「この投稿は 8 機能のうちどれに特に傾いて
  // いるか」だけが寄与する。
  const scoreAcc: CognitiveScores = { Ni: 0, Ne: 0, Si: 0, Se: 0, Ti: 0, Te: 0, Fi: 0, Fe: 0 };
  const fnKeys = Object.keys(cognitivePrototypes) as CogFunction[];
  let totalWeight = 0;
  const F = fnKeys.length;
  for (let i = 0; i < postEmbeddings.length; i++) {
    const vec = postEmbeddings[i]!;
    const w = weights[i] ?? 1;
    totalWeight += w;

    const perFn = new Array<number>(F);
    let postMean = 0;
    for (let f = 0; f < F; f++) {
      const s = topNAverage(vec, cognitivePrototypes[fnKeys[f]!]);
      perFn[f] = s;
      postMean += s;
    }
    postMean /= F;
    for (let f = 0; f < F; f++) {
      scoreAcc[fnKeys[f]!] += (perFn[f]! - postMean) * w;
    }
  }
  const avg = {} as CognitiveScores;
  const denom = totalWeight > 0 ? totalWeight : postEmbeddings.length;
  for (const fn of fnKeys) avg[fn] = scoreAcc[fn] / denom;

  const normalized = normalizeCognitive(avg);
  const rpgStats = cognitiveToRpg(normalized);
  const { archetype } = determineArchetype(normalized);
  const confidence = computeConfidence(postCount, normalized);

  return {
    archetype,
    rpgStats,
    cognitiveScores: normalized,
    confidence,
    analyzedPostCount: postCount,
    analyzedAt: now.toISOString(),
  };
}
