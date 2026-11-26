/**
 * 回復の量の幅 (D-HEAL-RANGE-001)。回復のどうぐ・回復のとくぎ・起こしたときの HP は、もとの量 ×
 * (1 − healSpread 〜 1 + healSpread) の整数 (1 以上)。全回復 (割合 1・量なし) だけは幅なしで最大 HP。
 * 使う人の うん が高いほど上のほうが出やすい (幅は超えない)。u ∈ [0,1) を u^(1/(1 + luk × healLukScale)) にする。
 * 乱数は呼ぶ側の rng (戦闘はターンの乱数、フィールドはサーバーの乱数)。画面はこれを呼ばない。
 */
import { BATTLE_TUNING } from './battle-tuning.js';
import type { SkillEffect } from './skills.js';

/** 回復のとくぎで戻る HP の もとの量 (対象の maxHp の割合)。幅をつける前。 */
export const healAmount = (maxHp: number, ratio: number): number => Math.round(maxHp * ratio);

/** もとの量 base に幅をつけた量。luk は使う人の うん。 */
export function spreadHeal(base: number, luk: number, rng: () => number): number {
  if (base <= 0) return 0;
  const { healSpread: s, healLukScale } = BATTLE_TUNING;
  const u = rng() ** (1 / (1 + Math.max(0, luk) * healLukScale));
  return Math.max(1, Math.round(base * (1 - s + 2 * s * u)));
}

/** heal 効果 1 つで戻る HP (幅つき)。全回復 (ratio 1・amount なし) は幅なしで maxHp。 */
export function rolledHeal(effect: Extract<SkillEffect, { kind: 'heal' }>, maxHp: number, luk: number, rng: () => number): number {
  if (effect.amount === undefined && (effect.ratio ?? 0) >= 1) return maxHp;
  return spreadHeal(effect.amount ?? healAmount(maxHp, effect.ratio ?? 0), luk, rng);
}
