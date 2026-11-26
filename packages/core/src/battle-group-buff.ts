/**
 * **敵が自分の群れを強くする** (D-BALANCE-002 案D の新しい仕組み (i))。debuffs の target 'allies'。
 * その敵と同じ群れの、生きている敵みんなに状態 (defUp・atkUp など) を付ける。1 体だけの戦いでは自分だけ。
 * 選ぶとき (pickDebuff) も使うとき (useMonsterDebuff) もここの `groupBuffTargets` で相手を決める。
 */
import { type Combatant } from './battle-combatant.js';

/** target 'allies' の相手: 群れ (group) の生きている敵。group が空なら自分だけ。 */
export function groupBuffTargets(self: Combatant, group: readonly Combatant[] | undefined): Combatant[] {
  const living = (group ?? []).filter((c) => c.hp > 0);
  return living.length ? living : [self];
}
