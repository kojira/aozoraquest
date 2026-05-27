/**
 * MTG 風カードのマナコスト・色・カードタイプ定義。
 *
 * MTG カラーパイ (WUBRG) に倣う:
 *   W (white):  秩序・集団・癒し・奉仕
 *   U (blue):   知識・分析・洞察
 *   B (black):  影・個人主義・暗
 *   R (red):    衝動・直接戦闘・即興
 *   G (green):  自然・本能・内的調和
 *
 * 加えて、色マナを含まない無色 (colorless) のカードは銀枠で描く。
 * 複数色のカードは金枠 (gold)。
 */

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
export type Color = (typeof COLORS)[number];

/** マナコスト。各色マナの数 + generic (任意色で払える数値マナ)。 */
export interface ManaCost {
  W?: number;
  U?: number;
  B?: number;
  R?: number;
  G?: number;
  /** 任意色でも払える generic マナ (MTG の {1} {2} {3} 等)。 */
  generic?: number;
}

export const CARD_TYPES = ['creature', 'artifact', 'instant', 'sorcery'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export function isCardType(s: unknown): s is CardType {
  return typeof s === 'string' && (CARD_TYPES as readonly string[]).includes(s);
}

/** 枠色の分類 (UI 表示用)。 */
export type FrameColor = 'colorless' | Color | 'gold';

export const CARD_TYPE_LABEL: Record<CardType, string> = {
  creature: 'クリーチャー',
  artifact: 'アーティファクト',
  instant: 'インスタント',
  sorcery: 'ソーサリー',
};

/** ManaCost が含む色マナの色一覧 (WUBRG 順)。 */
export function manaCostColors(cost: ManaCost): readonly Color[] {
  return COLORS.filter((c) => (cost[c] ?? 0) > 0);
}

/** ManaCost の合計マナ数 (色マナ + generic)。 */
export function manaCostTotal(cost: ManaCost): number {
  let sum = cost.generic ?? 0;
  for (const c of COLORS) sum += cost[c] ?? 0;
  return sum;
}

/** ManaCost から枠色を決める。色マナ 0 = 無色、1 色 = その色、2 色以上 = gold。 */
export function frameColorOf(cost: ManaCost): FrameColor {
  const colors = manaCostColors(cost);
  if (colors.length === 0) return 'colorless';
  if (colors.length === 1) return colors[0]!;
  return 'gold';
}

/** ManaCost が空か (全部 0 / undefined)。 */
export function isEmptyManaCost(cost: ManaCost): boolean {
  return manaCostTotal(cost) === 0;
}

/**
 * 数値を 0 以上の整数に丸めて、不正値 (NaN, 負数, 小数) を safe にする。
 * LLM 出力の sanitize 用。
 */
export function sanitizeManaCost(cost: Partial<ManaCost> | null | undefined): ManaCost {
  if (!cost) return {};
  const out: ManaCost = {};
  const cap = 99;
  for (const k of [...COLORS, 'generic'] as const) {
    const v = cost[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const n = Math.max(0, Math.min(cap, Math.floor(v)));
    if (n > 0) out[k] = n;
  }
  return out;
}
