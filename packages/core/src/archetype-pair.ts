/**
 * archetype ペアの関係カテゴリ判定。
 *
 * 16 気質型の相性は、2 人の気質スタック (dom, aux) の関係性で質的に分類できる、
 * という枠組みに基づく (Socionics 由来の intertype 関係論を簡略化したもの)。
 * peer-review で厳密に validate されている枠組みではないが、「16 型診断には型
 * 同士の相性表が付きもの」という UX 期待に応えるため採用する。
 *
 * カテゴリ一覧 (baseScore は暫定。β データで再校正予定):
 *   identity  恒等  0.55  同じ型 (理解しやすいが発展しにくい)
 *   duality   双対  0.90  dom と aux が完全に反転 (互いの弱点を補う理想形)
 *   mirror    鏡像  0.75  dom と aux を入れ替えただけ (同じテーマを別角度から)
 *   activity  活動  0.70  dom の attitude が同じで letter が対 (刺激し合う)
 *   kindred   類似  0.55  dom が同じ (共通基盤があるが役割が被る)
 *   contrary  対比  0.40  dom の letter が対 + attitude も逆 (噛み合わない時がある)
 *   conflict  衝突  0.20  dom / aux の letter が共に対 (根本から見方が違う)
 *   other     その他 0.50  上記どれにも該当しない
 *
 * スコア絶対値は暫定値。validation フェーズで β 運用データから再校正予定。
 */

import { JOBS_BY_ID } from './jobs.js';
import type { Archetype, CogFunction, JobDefinition } from './types.js';

export type ArchetypePairCategory =
  | 'identity'
  | 'duality'
  | 'mirror'
  | 'activity'
  | 'kindred'
  | 'contrary'
  | 'conflict'
  | 'other';

export interface ArchetypePairRelation {
  category: ArchetypePairCategory;
  /** カテゴリの日本語ラベル */
  label: string;
  /** カテゴリの短い説明 (UI tooltip 用) */
  description: string;
  /** カテゴリ由来のベーススコア (0-1)。最終 resonance はこれを主に、stat 連続指標で微調整する */
  baseScore: number;
}

export const ARCHETYPE_PAIR_CATEGORIES: Record<ArchetypePairCategory, { label: string; description: string; baseScore: number }> = {
  identity: { label: '同じ星のもと',     description: '同じ気質を持つ二人。語らずとも通じるが、新しい発見は少ない。',   baseScore: 0.55 },
  duality:  { label: '運命の対',         description: '剣と盾のように欠けを埋め合う、理想の組み合わせ。',                 baseScore: 0.90 },
  mirror:   { label: '鏡映しの相棒',     description: '同じ頂を反対側から見上げる関係。掘るほどに共鳴が深まる。',         baseScore: 0.75 },
  activity: { label: '併走の仲',         description: '同じ風を受けて走る二人。並んで加速する仲間。',                     baseScore: 0.70 },
  kindred:  { label: '同志の旅路',       description: '同じ旗を掲げる仲間。歩み方の違いで時に火花が散る。',               baseScore: 0.55 },
  contrary: { label: '背中合わせの道',   description: '逆の道をゆく二人。すれ違う一瞬に、思わぬ真実が見える。',           baseScore: 0.40 },
  conflict: { label: '異流の者',         description: '異なる神々に仕える者たち。分かり合うには長い旅路が要る。',         baseScore: 0.20 },
  other:    { label: '星読みの外',       description: '星の巡りにも語られぬ、前例のない縁。二人だけの物語。',             baseScore: 0.50 },
};

// ── 補助: 文字 / attitude の対比判定 ──────────────────
const OPPOSITE_LETTER: Record<string, string> = { N: 'S', S: 'N', T: 'F', F: 'T' };

function letterOf(fn: CogFunction): string { return fn[0]!; }
function attitudeOf(fn: CogFunction): string { return fn[1]!; }
function isOppositeLetter(a: CogFunction, b: CogFunction): boolean {
  return OPPOSITE_LETTER[letterOf(a)] === letterOf(b);
}
function isOppositeAttitude(a: CogFunction, b: CogFunction): boolean {
  return attitudeOf(a) !== attitudeOf(b);
}
function isFullOpposite(a: CogFunction, b: CogFunction): boolean {
  return isOppositeLetter(a, b) && isOppositeAttitude(a, b);
}

function classify(a: JobDefinition, b: JobDefinition): ArchetypePairCategory {
  const { dominantFunction: domA, auxiliaryFunction: auxA } = a;
  const { dominantFunction: domB, auxiliaryFunction: auxB } = b;

  // 恒等
  if (domA === domB && auxA === auxB) return 'identity';
  // 鏡像 (dom ↔ aux の入れ替え)
  if (domA === auxB && auxA === domB) return 'mirror';
  // 双対 (dom, aux ともに letter と attitude 両方が反転)
  if (isFullOpposite(domA, domB) && isFullOpposite(auxA, auxB)) return 'duality';
  // 衝突 (dom, aux ともに letter が対・attitude は同じ = attitude が反転でない)
  if (
    isOppositeLetter(domA, domB) && !isOppositeAttitude(domA, domB) &&
    isOppositeLetter(auxA, auxB) && !isOppositeAttitude(auxA, auxB)
  ) return 'conflict';
  // 対比 (dom が letter も attitude も反転、同じく aux も letter のみ反転するケース等の広めの「逆だが噛み合う余地」)
  if (isFullOpposite(domA, domB) || isFullOpposite(auxA, auxB)) return 'contrary';
  // 活動 (dom の attitude が同じで letter が対)
  if (attitudeOf(domA) === attitudeOf(domB) && isOppositeLetter(domA, domB)) return 'activity';
  // 類似 (dom が同じ、aux が違う)
  if (domA === domB) return 'kindred';
  return 'other';
}

/** 2 つの archetype の関係カテゴリを返す (引数順には依存しない対称関係)。 */
export function archetypePairRelation(a: Archetype, b: Archetype): ArchetypePairRelation {
  const jobA = JOBS_BY_ID[a];
  const jobB = JOBS_BY_ID[b];
  const category = classify(jobA, jobB);
  const meta = ARCHETYPE_PAIR_CATEGORIES[category];
  return { category, label: meta.label, description: meta.description, baseScore: meta.baseScore };
}
