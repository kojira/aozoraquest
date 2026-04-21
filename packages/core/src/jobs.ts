import { type Archetype, type CogFunction, type JobDefinition, type StatArray, type StatVector } from './types.js';

/**
 * 16 ジョブ定義 (docs/data/jobs.json と同期)。
 * stats は [atk, def, agi, int, luk] 順、合計 100。
 */
export const JOBS: readonly JobDefinition[] = [
  { id: 'sage',      names: { default: '賢者',     maker: '建築家',   alt: '戦略家' },   stats: [25, 14, 10, 37, 14], dominantFunction: 'Ni', auxiliaryFunction: 'Te' },
  { id: 'mage',      names: { default: '魔法使い', maker: '錬金術師', alt: '研究者' },   stats: [ 7, 23, 16, 31, 23], dominantFunction: 'Ti', auxiliaryFunction: 'Ne' },
  { id: 'shogun',    names: { default: '将軍',     maker: '棟梁',     alt: '起業家' },   stats: [38, 10, 14, 28, 10], dominantFunction: 'Te', auxiliaryFunction: 'Ni' },
  { id: 'bard',      names: { default: '吟遊詩人', maker: '発明家',   alt: '即興師' },   stats: [ 7, 20, 23, 20, 30], dominantFunction: 'Ne', auxiliaryFunction: 'Ti' },
  { id: 'seer',      names: { default: '予言者',   maker: '導師',     alt: '語り部' },   stats: [ 7, 14, 13, 44, 22], dominantFunction: 'Ni', auxiliaryFunction: 'Fe' },
  { id: 'poet',      names: { default: '詩人',     maker: '職人',     alt: '彫刻家' },   stats: [14, 34, 12,  7, 33], dominantFunction: 'Fi', auxiliaryFunction: 'Ne' },
  { id: 'paladin',   names: { default: '聖騎士',   maker: '教育者',   alt: '案内人' },   stats: [ 7, 16, 16, 32, 29], dominantFunction: 'Fe', auxiliaryFunction: 'Ni' },
  { id: 'explorer',  names: { default: '冒険者',   maker: '触媒',     alt: '旅芸人' },   stats: [18, 24, 20,  8, 30], dominantFunction: 'Ne', auxiliaryFunction: 'Fi' },
  { id: 'warrior',   names: { default: '戦士',     maker: '書記',     alt: '鍛冶師' },   stats: [24, 42,  8,  9, 17], dominantFunction: 'Si', auxiliaryFunction: 'Te' },
  { id: 'guardian',  names: { default: '守護者',   maker: '司書',     alt: '家守' },     stats: [ 7, 39, 10, 20, 24], dominantFunction: 'Si', auxiliaryFunction: 'Fe' },
  { id: 'fighter',   names: { default: '武闘家',   maker: '技師',     alt: '匠' },       stats: [10, 13, 22, 42, 13], dominantFunction: 'Ti', auxiliaryFunction: 'Se' },
  { id: 'dancer',    names: { default: '芸術家',   maker: '工芸家',   alt: '庭師' },     stats: [15, 20, 23, 15, 27], dominantFunction: 'Fi', auxiliaryFunction: 'Se' },
  { id: 'captain',   names: { default: '隊長',     maker: '指揮者',   alt: '管理官' },   stats: [34, 28, 10, 10, 18], dominantFunction: 'Te', auxiliaryFunction: 'Si' },
  { id: 'miko',      names: { default: '巫女',     maker: '世話役',   alt: '看護師' },   stats: [ 7, 32, 10, 15, 36], dominantFunction: 'Fe', auxiliaryFunction: 'Si' },
  { id: 'gladiator', names: { default: '剣闘士',   maker: '職方',     alt: '現場監督' }, stats: [15, 10, 33, 27, 15], dominantFunction: 'Se', auxiliaryFunction: 'Ti' },
  { id: 'performer', names: { default: '遊び人',   maker: '芸人',     alt: '祭司' },     stats: [20, 12, 30, 10, 28], dominantFunction: 'Se', auxiliaryFunction: 'Fi' },
];

export const JOBS_BY_ID: Record<Archetype, JobDefinition> = Object.fromEntries(
  JOBS.map(j => [j.id, j]),
) as Record<Archetype, JobDefinition>;

/** ドミナント × オグジリアリーのペアからアーキタイプを決定 */
const FUNCTION_PAIR_TO_ARCHETYPE: Record<string, Archetype> = Object.fromEntries(
  JOBS.map(j => [`${j.dominantFunction}-${j.auxiliaryFunction}`, j.id]),
);

export function archetypeFromFunctionPair(dom: CogFunction, aux: CogFunction): Archetype | null {
  return FUNCTION_PAIR_TO_ARCHETYPE[`${dom}-${aux}`] ?? null;
}

/** ジョブ表示名を取得 (ユーザー設定のバリアントに応じて)。未知 ID は「旅人」。 */
export function jobDisplayName(id: string, variant: 'default' | 'maker' | 'alt' = 'default'): string {
  if (id in JOBS_BY_ID) return JOBS_BY_ID[id as Archetype].names[variant];
  return '旅人';
}

/** ベクトル (配列) を StatVector (オブジェクト) に変換 */
export function statArrayToVector(arr: StatArray): StatVector {
  return { atk: arr[0], def: arr[1], agi: arr[2], int: arr[3], luk: arr[4] };
}

export function statVectorToArray(v: StatVector): StatArray {
  return [v.atk, v.def, v.agi, v.int, v.luk] as const;
}

/**
 * ピアソン相関でユーザーステータスとジョブ配分の「形の類似度」を計算。
 * 完全一致=1、無相関=0、対極=負数 (呼び出し側でクリップ推奨)。
 */
export function shapeSimilarity(user: StatArray, job: StatArray): number {
  const uMean = mean(user);
  const jMean = mean(job);
  const uC = user.map(v => v - uMean);
  const jC = job.map(v => v - jMean);
  const dot = uC.reduce((s, u, i) => s + u * jC[i]!, 0);
  const uMag = Math.hypot(...uC);
  const jMag = Math.hypot(...jC);
  if (uMag === 0 || jMag === 0) return 0;
  return dot / (uMag * jMag);
}

/** 現在のステータスに最も近いジョブを返す。0.3 未満なら「旅人」として null */
export function currentJob(userStats: StatArray, threshold = 0.3): { jobId: Archetype; score: number } | null {
  let best: { jobId: Archetype; score: number } | null = null;
  for (const j of JOBS) {
    const score = shapeSimilarity(userStats, j.stats);
    if (!best || score > best.score) best = { jobId: j.id, score };
  }
  if (!best || best.score < threshold) return null;
  return best;
}

/** 旅人度: 標準偏差が低い (=平坦) ほど高い値を返す */
export function wandererScore(stats: StatArray): number {
  const variance = stdev(stats);
  return Math.max(0, Math.min(1, 1 - variance / 10));
}

// ─── utils ───
function mean(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stdev(arr: readonly number[]): number {
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}
