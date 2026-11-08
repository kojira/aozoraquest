/**
 * 敵の技 (呪文・ため攻撃の解放・弱体と自分への強化) の実行と MP。1 人戦 (resolveTurn) と群れ (resolveTurnMulti) の
 * 両方がここを呼ぶ。1 人戦は allies = [主人公] の退化ケース (D-PARTY-002 §12a)。
 * - 全体 (target 'all') は生きている味方全員。MP は単体の BATTLE_TUNING.monsterAoeMpFactor 倍。
 * - 全体を使ったら combatant.lastAoe を立て、次の手番では全体を選ばない (battle-monster-ai)。
 */
import { BATTLE_TUNING } from './battle-tuning.js';
import { type Combatant } from './battle-combatant.js';
import { type MonsterDef, type MonsterDebuff, type MonsterMoveTarget } from './battle-monsters.js';
import { type TurnEvent } from './battle-state.js';
import { doAttack, doMagic } from './battle-attack.js';
import { applyStatus, statusApplyText } from './statuses.js';

const aoeFactor = (target: MonsterMoveTarget | 'self' | undefined) => (target === 'all' ? BATTLE_TUNING.monsterAoeMpFactor : 1);

/** 呪文の MP。 */
export function spellMpCost(def: MonsterDef | undefined): number {
  return BATTLE_TUNING.monsterCastMpCost * aoeFactor(def?.spell?.target);
}
/** ため (宣言時に払う) の MP。全体のため攻撃は重い。 */
export function chargeMpCost(def: MonsterDef | undefined): number {
  return BATTLE_TUNING.monsterChargeMpCost * aoeFactor(def?.chargedTarget);
}
/** 弱体・自分への強化の MP。 */
export function debuffMpCost(d: MonsterDebuff): number {
  return BATTLE_TUNING.monsterDebuffMpCost * aoeFactor(d.target);
}

const living = (arr: readonly Combatant[]) => arr.filter((c) => c.hp > 0);

/** 技の相手。one = 単体の選び方 (群れはランダムな生存者、1 人戦は主人公。1 人戦の乱数の並びを変えない)、
 *  allies = 味方 (全体・弱体の判定に使う)。 */
export interface MonsterTargets {
  allies: readonly Combatant[];
  one: () => Combatant | undefined;
}
const hasStatus = (c: Combatant, id: string) => (c.statuses ?? []).some((s) => s.id === id);

/** いま使える弱体・強化 (先頭から: MP が足り、直前が全体なら全体以外、まだ付いていない状態があるもの)。 */
export function pickDebuff(def: MonsterDef | undefined, self: Combatant, allies: readonly Combatant[]): MonsterDebuff | undefined {
  return (def?.debuffs ?? []).find((d) => {
    if (self.mp < debuffMpCost(d)) return false;
    if (d.target === 'all' && self.lastAoe) return false;
    if (d.target === 'self') return !hasStatus(self, d.status);
    return living(allies).some((a) => !hasStatus(a, d.status));
  });
}

/** 呪文を撃つ (MP を払う)。 */
export function castMonsterSpell(enemy: Combatant, def: MonsterDef, to: MonsterTargets, rng: () => number, events: TurnEvent[]): void {
  const spell = def.spell!;
  enemy.mp = Math.max(0, enemy.mp - spellMpCost(def));
  const span = spell.max - spell.min;
  const amount = spell.min + Math.floor(rng() * (span + 1)) + Math.round(enemy.int * (spell.intScale ?? 0));
  const all = spell.target === 'all';
  const targets = all ? living(to.allies) : [to.one()].filter((c): c is Combatant => !!c);
  for (const target of targets) {
    if (enemy.hp <= 0) break; // はね返されて倒れた
    doMagic(enemy, target, rng, events, 'monster', { amount, ...(spell.element ? { element: spell.element } : {}), label: spell.name });
  }
  enemy.lastAoe = all;
}

/** ため攻撃を解放する (MP は宣言のときに払い済み)。 */
export function releaseMonsterCharge(enemy: Combatant, def: MonsterDef | undefined, to: MonsterTargets, rng: () => number, events: TurnEvent[]): void {
  enemy.charging = false;
  const all = def?.chargedTarget === 'all';
  const targets = all ? living(to.allies) : [to.one()].filter((c): c is Combatant => !!c);
  for (const target of targets) {
    if (enemy.hp <= 0) break; // とげで倒れた
    doAttack(enemy, target, rng, events, 'monster', { power: BATTLE_TUNING.chargedPower, hitBonus: -0.05, label: def?.skillName ?? 'つよいこうげき' });
  }
  enemy.lastAoe = all;
}

/** 弱体 (味方へ) か自分への強化を使う (MP を払う)。付かなければ「きかなかった」。 */
export function useMonsterDebuff(enemy: Combatant, d: MonsterDebuff, allies: readonly Combatant[], rng: () => number, events: TurnEvent[]): void {
  enemy.mp = Math.max(0, enemy.mp - debuffMpCost(d));
  events.push({ actor: 'monster', text: `${enemy.name}の ${d.name}!` });
  // 単体はまだ付いていない味方から選ぶ (1 人なら引かない)。
  const free = living(allies).filter((a) => !hasStatus(a, d.status));
  const one = free.length > 1 ? free[Math.floor(rng() * free.length)] : free[0];
  const targets = d.target === 'self' ? [enemy] : d.target === 'all' ? living(allies) : [one].filter((c): c is Combatant => !!c);
  for (const target of targets) {
    const took = rng() < d.chance && applyStatus(target, { id: d.status, turns: d.turns, ...(d.magnitude !== undefined ? { magnitude: d.magnitude } : {}) });
    events.push({ actor: 'monster', text: took ? statusApplyText(d.status, target.name) : `しかし ${target.name}には きかなかった!` });
  }
  enemy.lastAoe = d.target === 'all';
}
