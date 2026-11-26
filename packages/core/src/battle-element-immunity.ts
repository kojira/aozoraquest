/**
 * **属性が効かない敵** (D-BALANCE-002 案D の新しい仕組み (ii))。MonsterDef.immune の属性の攻撃は 0 倍。
 * 物理 (doAttack・属性つき武器) と呪文・どうぐ (doMagic) の両方が、属性の倍率にここを掛ける。
 * 無属性の攻撃は効く (物理の通常攻撃で倒せる)。
 */
import { type Element } from './elements.js';
import { type Combatant } from './battle-combatant.js';

/** その属性が効かなければ 0、効けば 1。 */
export function elementImmunityMultiplier(defender: Combatant, element: Element | undefined): number {
  return element && defender.immuneElements?.includes(element) ? 0 : 1;
}

/** 効かなかったときの 1 行。 */
export function elementImmunityText(defender: Combatant): string {
  return `${defender.name}には まったく 効かない!`;
}
