/**
 * sim-party / sim-party-boss の共通部 (D-PARTY-001)。core を読み、モンスターを入れ、パーティの 1 戦を回す。
 * 仲間の手は core の allyAutoAction (resolveTurnMulti の中で動く)。主人公の手は群れなら全体技 → 一番弱い敵に
 * 1 対 1 の autoBattleAction、1 対 1 なら autoBattleAction。主人公が倒れたら負け (core)。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tree = process.env.TREE ?? resolve(here, '..');
export const core = (await import(`${tree}/packages/core/src/index.js`)) as typeof import('../packages/core/src/index.js');
const { TEST_MONSTERS } = (await import(`${resolve(here, '..')}/packages/core/src/__tests__/helpers/monster-fixture.js`)) as typeof import('../packages/core/src/__tests__/helpers/monster-fixture.js');
/** MONSTERS_JSON = `node scripts/admin-data.mjs get monsters` の出力 (dev の実データ)。無ければ fixture。 */
if (process.env.MONSTERS_JSON) core.setMonsterOverrides(core.decodeMonstersFromRecord(JSON.parse(readFileSync(process.env.MONSTERS_JSON, 'utf8')).value.monsters));
else core.setMonsterOverrides(TEST_MONSTERS);

const { startBattle, resolveTurn, resolveTurnMulti, autoBattleAction, skillMpCostOf, battleXpFor, partyMembers, SKILLS, BATTLE_TUNING } = core;
type Archetype = import('../packages/core/src/index.js').Archetype;
type BattleState = import('../packages/core/src/index.js').BattleState;
type RecruitDef = import('../packages/core/src/index.js').RecruitDef;

/** 仲間の組み合わせ (主人公を除く)。 */
export const PARTIES: Record<string, Archetype[]> = { solo: [], duo: ['warrior'], trio: ['warrior', 'miko'], full: ['warrior', 'mage', 'miko'] };
const isAoe = (k: string) => !!SKILLS[k]?.effects.some((e) => e.target === 'allEnemies' && (e.kind === 'damage' || e.kind === 'fixedDamage'));
/** 主人公の装備 (仲間の PARTY_ARMOR と同じ段階)。 */
const heroGear = (lv: number) => (lv >= core.PARTY_ARMOR.fromLevel ? [core.PARTY_ARMOR.id] : []);

export interface PartyCarry { hp: number; mp: number; herbs: number; mates: Record<string, number>; matesMp: Record<string, number> }
export interface FightOpts { monsterId?: string; story?: boolean; extraEnemies: number; bossHpPerAlly?: number; carry?: PartyCarry; tonics?: number }

/** 1 戦。edge の sealEncounter と同じく、仲間を allies に並べ、ストーリー戦なら敵 HP に倍率を掛ける。 */
export function fight(job: Archetype, lv: number, tier: number, seed: number, mates: readonly Archetype[], o: FightOpts) {
  const herbs = o.carry?.herbs ?? BATTLE_TUNING.herbCarryMax;
  let s: BattleState = startBattle(job, lv, 1, 'hero', tier as never, seed >>> 0, herbs, o.carry ? { hp: o.carry.hp, mp: o.carry.mp } : undefined, {
    tonics: o.tonics ?? BATTLE_TUNING.tonicCarryMax, extraEnemies: o.extraEnemies, vitalsVariance: BATTLE_TUNING.monsterVitalsVariance, equipIds: heroGear(lv),
    ...(o.monsterId ? { monsterId: o.monsterId } : {}), ...(o.story ? { story: { canFlee: false } } : {}),
  });
  const defs: RecruitDef[] = mates.map((a, i) => ({ id: `m${i}`, name: `mate${i}`, archetype: a, guild: 'g', line: '.' }));
  const members = partyMembers(defs, lv, o.carry ? { hp: o.carry.mates, mp: o.carry.matesMp } : {});
  if (members.length) {
    const enemies = s.enemies ?? [s.monster];
    s = { ...s, allies: [s.player, ...members.map((m) => m.combatant)], enemies };
    if (o.story) { const f = 1 + (o.bossHpPerAlly ?? BATTLE_TUNING.bossHpPerAlly) * members.length; for (const e of enemies) { e.maxHp = Math.round(e.maxHp * f); e.hp = e.maxHp; } }
  }
  const multi = (s.enemies?.length ?? 1) > 1 || (s.allies?.length ?? 1) > 1;
  let turns = 0;
  for (let i = 0; i < 80 && s.outcome === 'ongoing'; i++) {
    turns++;
    if (!multi) { const a = autoBattleAction(s); s = resolveTurn(s, a.command, undefined, a.skillIndex); continue; }
    const living = (s.enemies ?? [s.monster]).filter((e) => e.hp > 0);
    const p = s.player; const cost = skillMpCostOf(p);
    const aoe = s.playerSkills.findIndex((k) => isAoe(k.kind));
    if (living.length >= 2 && aoe >= 0 && p.mp >= cost && !(s.herbs > 0 && p.hp < p.maxHp * 0.45)) { s = resolveTurnMulti(s, 'skill', undefined, aoe, 0); continue; }
    const tgt = living.reduce((a, b) => (b.hp < a.hp ? b : a));
    const view = { ...s, monster: tgt } as BattleState; delete view.allies; delete view.enemies;
    let a = autoBattleAction(view);
    if (living.some((e) => e.charging) && a.command !== 'skill') a = { command: 'guard', skillIndex: 0 };
    s = resolveTurnMulti(s, a.command, undefined, a.skillIndex, living.indexOf(tgt));
  }
  const killed = (s.enemies ?? [s.monster]).filter((e) => e.hp <= 0).map((e) => e.monsterId ?? s.monsterId);
  const mates2: Record<string, number> = { ...o.carry?.mates }, matesMp: Record<string, number> = { ...o.carry?.matesMp };
  members.forEach((m, i) => { const c = s.allies![i + 1]!; mates2[m.id] = c.hp; matesMp[m.id] = c.mp; });
  return { outcome: s.outcome, turns, xp: s.outcome === 'win' ? killed.reduce((n, id) => n + battleXpFor(id), 0) : 0,
    carry: { hp: s.player.hp, mp: s.player.mp, herbs: s.herbs, mates: mates2, matesMp } satisfies PartyCarry };
}

export const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!;
export const minOf = (v: number[]) => Math.min(...v);
