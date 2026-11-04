/**
 * めいれい の仲間の 1 手 (♥3。D-PARTY-004 §2)。主人公と同じ手を、その仲間のとくぎ・MP で行う。
 * - ねらう相手はターンの頭に生きていた相手を覚えておき、動く時点の番号へ数えなおす (主人公と同じ)。
 *   先に倒れていたら 敵は生きている先頭、味方は主人公
 * - MP 不足・どうぐ切れ は主人公と同じく「たたかう」に落とす。どうぐ・やくそう・しずく は共有の在庫から行動順に減らす
 * (公開 API は battle.ts から再エクスポート)
 */
import { SKILLS, runSkillMulti } from './skills.js';
import { resolveTargets, type CombatSides } from './combat-target.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { skillMpCostOf, skillsForJob } from './battle-job-skills.js';
import { type Combatant } from './battle-combatant.js';
import { type AllyOrder, type BattleState, type Command, type TurnEvent } from './battle-state.js';
import { doAttack, doMagic } from './battle-attack.js';
import { canUseBattleItem, itemTargetsOneAlly, missingBattleItemText, skillTargetsOneAlly, useBattleItem } from './battle-items.js';

/** ターンの頭に決めた めいれい (ねらう相手を覚えておく)。 */
export interface PinnedOrder { order: AllyOrder; foe?: Combatant | undefined; mate?: Combatant | undefined }

const living = (arr: readonly Combatant[]) => arr.filter((c) => c.hp > 0);

/** 味方をねらう手か (やくそう・しずく・味方 1 人のとくぎ/どうぐ)。 */
function aimsAlly(actor: Combatant, o: AllyOrder): boolean {
  if (o.command === 'herb' || o.command === 'tonic') return true;
  if (o.command === 'item') return !!o.itemId && itemTargetsOneAlly(o.itemId);
  if (o.command !== 'skill' || !actor.job) return false;
  return skillTargetsOneAlly(skillsForJob(actor.job.archetype, actor.job.level)[o.skillIndex]?.kind ?? '');
}

/** allies の並びの めいれい を、ターンの頭の相手つきに。仲間 (job あり) のぶんだけ。 */
export function pinAllyOrders(allies: readonly Combatant[], enemies: readonly Combatant[], orders: ReadonlyArray<AllyOrder | undefined> | undefined): Array<PinnedOrder | undefined> {
  return allies.map((a, i) => {
    const order = i > 0 && a.job ? orders?.[i] : undefined;
    if (!order) return undefined;
    return { order, foe: living(enemies)[order.targetIndex], mate: aimsAlly(a, order) ? living(allies)[order.targetIndex] : undefined };
  });
}

/** 在庫が無いときの告知 (無ければ null)。主人公と めいれい の仲間が同じ在庫を行動順に使うので、動く時点で見る。 */
export function outOfStockText(state: BattleState, command: Command, itemId: string | undefined): string | null {
  if (command === 'herb' && state.herbs <= 0) return 'やくそうを持っていない!';
  if (command === 'tonic' && state.tonics <= 0) return 'そらのしずくを持っていない!';
  if (command === 'item' && !canUseBattleItem(state, itemId)) return missingBattleItemText(itemId);
  return null;
}

/** めいれい の 1 手を行う。 */
export function runAllyOrder(actor: Combatant, pinned: PinnedOrder, state: BattleState, sides: CombatSides, rng: () => number, events: TurnEvent[]): void {
  const { order } = pinned;
  const skills = skillsForJob(actor.job!.archetype, actor.job!.level);
  const skill = skills[order.skillIndex];
  const cost = skillMpCostOf(actor);
  let cmd: AllyOrder['command'] = order.command;
  const missing = outOfStockText(state, cmd, order.itemId);
  if (missing) { events.push({ actor: 'player', text: missing }); cmd = 'attack'; }
  if (cmd === 'skill' && (!skill || !SKILLS[skill.kind])) cmd = 'attack';
  if (cmd === 'skill' && actor.mp < cost) { events.push({ actor: 'player', text: `${actor.name}は MPが足りない! (${actor.mp}/${cost})` }); cmd = 'attack'; }
  const foeIndex = Math.max(0, living(sides.enemies).indexOf(pinned.foe!));
  const mateIndex = Math.max(0, living(sides.allies).indexOf(pinned.mate!));
  const mate = living(sides.allies)[mateIndex] ?? actor;
  if (cmd === 'attack') {
    const target = resolveTargets(actor, 'oneEnemy', sides, { targetIndex: foeIndex })[0];
    if (target) doAttack(actor, target, rng, events, 'player');
  } else if (cmd === 'guard') {
    actor.guarding = true;
    events.push({ actor: 'player', text: `${actor.name}はぼうぎょのかまえ!` });
  } else if (cmd === 'skill') {
    const def = SKILLS[skill!.kind]!;
    actor.mp -= cost;
    if (def.parry) {
      actor.parrying = true;
      events.push({ actor: 'player', text: `${actor.name}は${skill!.name}の構え! (防御しつつ反撃)` });
      return;
    }
    runSkillMulti(def, actor, sides, (defender) => ({ attacker: actor, defender, rng, events, skillName: skill!.name, actorSide: 'player', engine: { doAttack, doMagic } }),
      { targetIndex: foeIndex, allyIndex: mateIndex, label: skill!.name, events, actor: 'player' });
  } else if (cmd === 'herb') {
    const heal = Math.round(mate.maxHp * BATTLE_TUNING.herbHealRatio);
    mate.hp = Math.min(mate.maxHp, mate.hp + heal);
    state.herbs -= 1;
    state.herbsUsed += 1;
    events.push({ actor: 'player', text: `${actor.name}はやくそうを使った! ${mate === actor ? '' : `${mate.name}の`}HPが${heal}回復。(残り${state.herbs})` });
  } else if (cmd === 'tonic') {
    const gain = Math.round(mate.maxMp * BATTLE_TUNING.tonicMpRatio);
    mate.mp = Math.min(mate.maxMp, mate.mp + gain);
    state.tonics -= 1;
    state.tonicsUsed += 1;
    events.push({ actor: 'player', text: `${actor.name}は${mate === actor ? '' : `${mate.name}に `}そらのしずくを${mate === actor ? '飲んだ' : '飲ませた'}! MPが${gain}回復。(残り${state.tonics})` });
  } else if (cmd === 'item') {
    useBattleItem(state, order.itemId!, sides, foeIndex, rng, events, mateIndex, actor);
  }
}
