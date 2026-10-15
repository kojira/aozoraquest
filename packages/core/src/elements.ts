/**
 * 属性システム (戦闘刷新 #452 / docs/25 §1)。
 *
 * 4 元素は一方向の輪 **地→水→火→風→(地)**(矢印=「強い」)。空 (void) は輪の外で、
 * 全属性に 1.2 倍で殴れる代わりに全属性から 1.2 倍食らう「万能だが脆い」属性。
 * holy/聖は**無属性 (null)** として扱い、属性の輪の影響を受けない (常に等倍)。
 *
 * データ駆動: 輪は `BEATS` テーブル 1 個 + 空ルールだけ。if 地獄にしない。
 */

export type Element = 'earth' | 'water' | 'fire' | 'wind' | 'void';

/** 輪: X が BEATS[X] に「強い」(有利)。空 (void) は輪の外なので null。 */
const BEATS: Record<Element, Element | null> = {
  earth: 'water',
  water: 'fire',
  fire: 'wind',
  wind: 'earth',
  void: null,
};

/** 有利/不利/空 の倍率 (数値は sim で調整可)。 */
export const ELEMENT_MULT = {
  strong: 1.5, // 輪で強い (弱点を突く)
  weak: 0.5, //   輪で弱い
  neutral: 1.0,
  voidMult: 1.2, // 空: 攻撃も被弾も 1.2
} as const;

/**
 * 攻撃属性 × 防御属性 → ダメージ倍率。
 * - 無属性 (null) が絡めば常に等倍 (物理・holy はここ)。
 * - 空 (void) が攻撃側 or 防御側にあれば 1.2 (器用貧乏の万能)。
 * - それ以外は輪: atk が def に強ければ 1.5 / 弱ければ 0.5 / 正面以外は 1.0。
 */
export function elementMultiplier(atk: Element | null | undefined, def: Element | null | undefined): number {
  if (!atk || !def) return ELEMENT_MULT.neutral; // 無属性は等倍
  if (atk === 'void' || def === 'void') return ELEMENT_MULT.voidMult; // 空は攻撃/被弾とも 1.2
  if (BEATS[atk] === def) return ELEMENT_MULT.strong; // 有利
  if (BEATS[def] === atk) return ELEMENT_MULT.weak; // 不利
  return ELEMENT_MULT.neutral; // 中立 (地↔火 / 水↔風)
}
