import { bondHearts, BOND_TUNING } from '@aozoraquest/core';

/** 仲間との きずな の見せ方 (D-PARTY-004)。♥ の数は core の bondHearts。 */

/** ♥♥♡ (いまの ♥ を塗り、残りは ♡)。 */
export function heartsText(bond: number | undefined): string {
  const n = bondHearts(bond);
  return '♥'.repeat(n) + '♡'.repeat(BOND_TUNING.hearts.length - n);
}

/** ♥ の数から ♥♥♡ (応答の hearts 用)。 */
export const heartsOf = (hearts: number): string => '♥'.repeat(hearts) + '♡'.repeat(Math.max(0, BOND_TUNING.hearts.length - hearts));

/** 「きずな 72／150（つぎの ♥ まで 78）」。上限なら つぎ は出さない。 */
export function bondDetailText(bond: number | undefined): string {
  const b = Math.max(0, Math.min(BOND_TUNING.max, bond ?? 0));
  const next = BOND_TUNING.hearts.find((h) => h > b);
  return `きずな ${b}／${BOND_TUNING.max}${next !== undefined ? `（つぎの ♥ まで ${next - b}）` : ''}`;
}

/** ♥ が増えたときの 1 行 (戦闘・クエスト報告・フィールドの回復で同じ文)。 */
export function bondUpLines(ups: ReadonlyArray<{ name: string; hearts: number }> | undefined): string[] {
  return (ups ?? []).map((u) => `${u.name}との きずなが ふかまった！（${heartsOf(u.hearts)}）`);
}
