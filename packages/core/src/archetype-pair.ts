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
  identity: { label: '恒等', description: '同じ気質。互いをよく理解するが、発展や気付きは少なめ。', baseScore: 0.55 },
  duality: { label: '双対', description: 'お互いの弱点を補い合う理想的な組み合わせ。', baseScore: 0.90 },
  mirror:  { label: '鏡像', description: '同じ機能を別の角度から見ている。共通テーマを深掘りできる。', baseScore: 0.75 },
  activity:{ label: '活動', description: '動きの向きが近く、刺激し合える関係。', baseScore: 0.70 },
  kindred: { label: '類似', description: '主機能が同じで価値観は重なるが、役割分担で衝突することも。', baseScore: 0.55 },
  contrary:{ label: '対比', description: '見方が逆でじれったいが、違いから気付きが生まれる。', baseScore: 0.40 },
  conflict:{ label: '衝突', description: '根本的に見方が違い、分かり合うのに時間がかかる。', baseScore: 0.20 },
  other:   { label: '独自', description: '典型パターンから外れた、名前の付けにくい組み合わせ。', baseScore: 0.50 },
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
