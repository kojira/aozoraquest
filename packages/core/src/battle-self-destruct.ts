/**
 * **HP が減ると自爆する敵** (D-BALANCE-002 案D の新しい仕組み (iii))。能力 'selfDestruct' と MonsterDef.selfDestruct。
 * - HP が below (最大HP の割合) を下回った手番は、自爆の前ぶれ (tell) を出すだけで攻撃しない。
 * - つぎの手番で自爆する: 生きている味方みんなに物理の大技 (power 倍。ぼうぎょで半分・守備が効く)、自分は倒れる。
 * - 前ぶれのあと、自爆の前に倒せば何も起きない。眠り・麻痺で動けない手番は待つ。
 * 1 人戦 (resolveTurn) と群れ (resolveTurnMulti) の両方がここを呼ぶ。MP は使わない。
 */
import { type Combatant } from './battle-combatant.js';
import { type MonsterDef } from './battle-monsters.js';
import { type TurnEvent } from './battle-state.js';
import { doAttack } from './battle-attack.js';

/** below と power の既定値。 */
export const SELF_DESTRUCT_DEFAULTS = { below: 0.3, power: 2.2 } as const;

/** 自爆の手番か (前ぶれ済み、または HP が below を下回った)。 */
export function wantsSelfDestruct(monster: Combatant, def: MonsterDef | undefined): boolean {
  if (!def?.selfDestruct) return false;
  if (monster.fuse) return true;
  return monster.hp / monster.maxHp < (def.selfDestruct.below ?? SELF_DESTRUCT_DEFAULTS.below);
}

/** 前ぶれを出す (まだなら) か、自爆する。 */
export function runSelfDestruct(enemy: Combatant, def: MonsterDef, allies: readonly Combatant[], rng: () => number, events: TurnEvent[]): void {
  const sd = def.selfDestruct!;
  if (!enemy.fuse) {
    enemy.fuse = true;
    events.push({ actor: 'monster', text: sd.tell });
    return;
  }
  enemy.fuse = false;
  events.push({ actor: 'monster', text: `${enemy.name}の ${sd.name}!` });
  for (const tg of allies.filter((c) => c.hp > 0)) {
    doAttack(enemy, tg, rng, events, 'monster', { power: sd.power ?? SELF_DESTRUCT_DEFAULTS.power, hitBonus: 0.2, label: sd.name });
  }
  enemy.hp = 0;
  events.push({ actor: 'monster', text: `${enemy.name}は くだけちった!`, fatal: true });
}
