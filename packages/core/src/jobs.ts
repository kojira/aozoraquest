import { type Archetype, type CogFunction, type JobDefinition, type StatArray, type StatVector } from './types.js';

/**
 * 16 ジョブ定義 (docs/data/jobs.json と同期)。
 * stats は [atk, def, agi, int, luk] 順、合計 100。
 */
export const JOBS: readonly JobDefinition[] = [
  // stats は認知機能スタック (dom 1.0 / aux 0.5 / tertiary 0.25 / inferior 0.125) を
  // COGNITIVE_TO_RPG で合成・正規化した理論値に、レーダー軸潰れ防止の floor を噛ませた値
  // (v = 6 + 0.7×理論値、affine なので Pearson 相関は理論値と 1.0 = currentJob 判定は不変)。
  // 再生成・検証は scripts/gen-job-stats.ts。16 型 MBTI と整合。
  { id: 'sage',      names: { default: '賢者',     maker: '建築家',   alt: '戦略家' },   stats: [22, 15,  9, 40, 14], dominantFunction: 'Ni', auxiliaryFunction: 'Te', primaryColor: 'U' },
  { id: 'mage',      names: { default: '魔法使い', maker: '錬金術師', alt: '研究者' },   stats: [ 7, 19, 19, 37, 18], dominantFunction: 'Ti', auxiliaryFunction: 'Ne', primaryColor: 'U' },
  { id: 'shogun',    names: { default: '将軍',     maker: '棟梁',     alt: '起業家' },   stats: [39, 10, 13, 28, 10], dominantFunction: 'Te', auxiliaryFunction: 'Ni', primaryColor: 'W' },
  { id: 'bard',      names: { default: '吟遊詩人', maker: '発明家',   alt: '即興師' },   stats: [ 7, 14, 27, 21, 31], dominantFunction: 'Ne', auxiliaryFunction: 'Ti', primaryColor: 'R' },
  { id: 'seer',      names: { default: '予言者',   maker: '導師',     alt: '語り部' },   stats: [ 8, 16, 10, 43, 23], dominantFunction: 'Ni', auxiliaryFunction: 'Fe', primaryColor: 'U' },
  { id: 'poet',      names: { default: '詩人',     maker: '職人',     alt: '彫刻家' },   stats: [11, 32, 15,  8, 34], dominantFunction: 'Fi', auxiliaryFunction: 'Ne', primaryColor: 'G' },
  { id: 'paladin',   names: { default: '聖騎士',   maker: '教育者',   alt: '案内人' },   stats: [ 9, 19, 13, 25, 34], dominantFunction: 'Fe', auxiliaryFunction: 'Ni', primaryColor: 'W' },
  { id: 'explorer',  names: { default: '冒険者',   maker: '触媒',     alt: '旅芸人' },   stats: [14, 19, 25,  8, 34], dominantFunction: 'Ne', auxiliaryFunction: 'Fi', primaryColor: 'G' },
  { id: 'warrior',   names: { default: '戦士',     maker: '書記',     alt: '鍛冶師' },   stats: [25, 41,  8, 13, 13], dominantFunction: 'Si', auxiliaryFunction: 'Te', primaryColor: 'R' },
  { id: 'guardian',  names: { default: '守護者',   maker: '司書',     alt: '家守' },     stats: [10, 43,  9, 17, 21], dominantFunction: 'Si', auxiliaryFunction: 'Fe', primaryColor: 'W' },
  // ISTP は 16personalities でも「巨匠 (Virtuoso)」。Ti 支配で知力が高いのは設計通りなので、
  // 物理を想起させる旧称「武闘家」をやめ、知力型の職人名「匠」に改名 (MBTI 分類は不変)。
  { id: 'fighter',   names: { default: '匠',       maker: '技師',     alt: '達人' },     stats: [12, 12, 23, 43, 10], dominantFunction: 'Ti', auxiliaryFunction: 'Se', primaryColor: 'R' },
  { id: 'artist',    names: { default: '芸術家',   maker: '工芸家',   alt: '庭師' },     stats: [15, 26, 19, 14, 26], dominantFunction: 'Fi', auxiliaryFunction: 'Se', primaryColor: 'G' },
  { id: 'captain',   names: { default: '隊長',     maker: '指揮者',   alt: '管理官' },   stats: [38, 23, 11, 15, 13], dominantFunction: 'Te', auxiliaryFunction: 'Si', primaryColor: 'W' },
  { id: 'miko',      names: { default: '巫女',     maker: '世話役',   alt: '看護師' },   stats: [ 8, 32, 11, 12, 37], dominantFunction: 'Fe', auxiliaryFunction: 'Si', primaryColor: 'W' },
  { id: 'ninja',     names: { default: '忍者',     maker: '職方',     alt: '現場監督' }, stats: [17, 11, 34, 25, 13], dominantFunction: 'Se', auxiliaryFunction: 'Ti', primaryColor: 'B' },
  { id: 'performer', names: { default: '遊び人',   maker: '芸人',     alt: '祭司' },     stats: [25, 16, 32, 11, 16], dominantFunction: 'Se', auxiliaryFunction: 'Fi', primaryColor: 'R' },
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

/** ジョブの一言説明 (名前の右に添える)。短めに保つ。 */
export const JOB_TAGLINES: Record<Archetype, string> = {
  sage:      '遠くを見通す戦略家',
  mage:      '仕組みを解く研究者',
  shogun:    '結果で示す指揮官',
  bard:      '言葉で場を動かす即興家',
  seer:      '静かに先を読む語り部',
  poet:      '自分の美で形を彫る',
  paladin:   '義を貫く守護者',
  explorer:  '未踏を楽しむ旅人',
  warrior:   '反復で鍛える堅実型',
  guardian:  '身近な人を守り続ける',
  fighter:   '体で覚え理で磨く',
  artist:    '感性を形に残す',
  captain:   '組織を回す実務家',
  miko:      '場を整え寄り添う',
  ninja:     '一瞬の見切りで決める',
  performer: '運と勘で生きる',
};

export function jobTagline(id: string): string | null {
  return id in JOB_TAGLINES ? JOB_TAGLINES[id as Archetype] : null;
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
