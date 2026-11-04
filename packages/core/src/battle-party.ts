/**
 * パーティの仲間 (D-PARTY-001)。ギルドで入れた冒険者を Combatant にし、戦闘で自動で動かす。
 * (公開 API は battle.ts から再エクスポート)
 *
 * - 強さは `playerCombatant(職, 仲間の Lv)`。仲間の Lv は自分の経験値から (D-PARTY-002 §11、partyDefsOf)。
 *   level の無い定義 (RecruitDef) は主人公のジョブ Lv。
 * - 手は職のとくぎから: 全体回復 (味方の誰かが HP 50% 未満) → 敵 2 体以上なら全体技 →
 *   それ以外は HP がいちばん低い敵を相手にした 1 対 1 の autoBattleAction。
 */
import { SKILLS } from './skills.js';
import { skillMpCostOf, skillsForJob } from './battle-job-skills.js';
import { type Combatant, playerCombatant } from './battle-combatant.js';
import { type Command, type BattleState } from './battle-state.js';
import { autoBattleAction } from './battle-auto.js';
import type { RecruitDef } from './recruits.js';

/** 入れられる人数 (主人公を含む) が増える章の終わりのフラグ。どれも無ければ 1 人。 */
export const PARTY_SIZE_FLAGS: ReadonlyArray<readonly [flag: string, size: number]> = [
  ['futaba_letter_done', 2],
  ['yuuhi_feather_done', 3],
  ['soyogi_feather_done', 4],
];
/** 仲間に自動で着せる防具と、着せはじめるジョブ Lv。 */
export const PARTY_ARMOR = { id: 'ar-cloth', fromLevel: 5 } as const;
/** 全体回復を使う目安 (味方の誰かがこの割合を下回ったら)。 */
const PARTY_HEAL_BELOW = 0.5;

/** 主人公を含めた、いま入れられる人数。 */
export function partyCapacity(flags: readonly string[]): number {
  return PARTY_SIZE_FLAGS.reduce((n, [flag, size]) => (flags.includes(flag) ? Math.max(n, size) : n), 1);
}

/** 持ちこしの HP/MP (仲間の id ごと)。値が無い仲間は全快。 */
export interface PartyCarry {
  hp?: Readonly<Record<string, number>>;
  mp?: Readonly<Record<string, number>>;
}

/** 仲間 1 人の定義。level があればその Lv、無ければ主人公のジョブ Lv で戦う。 */
export type PartyMemberDef = Pick<RecruitDef, 'id' | 'name' | 'archetype'> & { level?: number };

/** 戦闘に出る仲間 (倒れた仲間 = HP 0 の持ちこしは出ない) を、入れている順に。 */
export function partyMembers(list: readonly PartyMemberDef[], jobLevel: number, carry: PartyCarry = {}): Array<{ id: string; combatant: Combatant }> {
  const out: Array<{ id: string; combatant: Combatant }> = [];
  for (const r of list) {
    const lv = r.level ?? jobLevel;
    const c = playerCombatant(r.archetype, lv, 1, r.name, undefined, lv >= PARTY_ARMOR.fromLevel ? [PARTY_ARMOR.id] : []);
    const hp = carry.hp?.[r.id];
    const mp = carry.mp?.[r.id];
    if (hp !== undefined) c.hp = Math.max(0, Math.min(c.maxHp, Math.floor(hp)));
    if (mp !== undefined) c.mp = Math.max(0, Math.min(c.maxMp, Math.floor(mp)));
    if (c.hp <= 0) continue;
    out.push({ id: r.id, combatant: { ...c, job: { archetype: r.archetype, level: lv } } });
  }
  return out;
}

export function partyCombatants(list: readonly PartyMemberDef[], jobLevel: number, carry: PartyCarry = {}): Combatant[] {
  return partyMembers(list, jobLevel, carry).map((m) => m.combatant);
}

const isPartyHeal = (kind: string) => !!SKILLS[kind]?.effects.some((e) => e.kind === 'heal' && e.target === 'allAllies');
const isAreaAttack = (kind: string) => !!SKILLS[kind]?.effects.some((e) => (e.kind === 'damage' || e.kind === 'fixedDamage') && e.target === 'allEnemies');

/** 仲間の 1 手。targetIndex は「生きている敵の中で何番目か」(resolveTargets の数え方)。 */
export function allyAutoAction(state: BattleState, allyIndex: number, turnSeed?: number): { command: Command; skillIndex: number; targetIndex: number } {
  const allies = state.allies ?? [state.player];
  const ally = allies[allyIndex]!;
  const skills = ally.job ? skillsForJob(ally.job.archetype, ally.job.level) : [];
  const cost = skillMpCostOf(ally);
  const living = (state.enemies ?? [state.monster]).filter((e) => e.hp > 0);
  const canCast = ally.mp >= cost;
  const heal = skills.findIndex((k) => isPartyHeal(k.kind));
  if (canCast && heal >= 0 && allies.some((a) => a.hp > 0 && a.hp < a.maxHp * PARTY_HEAL_BELOW)) return { command: 'skill', skillIndex: heal, targetIndex: 0 };
  const area = skills.findIndex((k) => isAreaAttack(k.kind));
  if (canCast && area >= 0 && living.length >= 2) return { command: 'skill', skillIndex: area, targetIndex: 0 };
  if (living.length === 0) return { command: 'attack', skillIndex: 0, targetIndex: 0 };
  const target = living.reduce((a, b) => (b.hp < a.hp ? b : a));
  const targetIndex = living.indexOf(target);
  if (skills.length === 0) return { command: 'attack', skillIndex: 0, targetIndex };
  // その仲間から見た 1 対 1 にして、主人公の自動戦闘と同じ選び方を使う。道具は持たない。
  const view: BattleState = { ...state, player: ally, monster: target, playerSkill: skills[0]!, playerSkills: skills, herbs: 0, tonics: 0 };
  delete view.allies;
  delete view.enemies;
  const a = autoBattleAction(view, turnSeed);
  if (a.command === 'skill' && canCast) return { command: 'skill', skillIndex: a.skillIndex, targetIndex };
  if (a.command === 'guard') return { command: 'guard', skillIndex: 0, targetIndex };
  return { command: 'attack', skillIndex: 0, targetIndex };
}
