/**
 * sim-party / sim-party-boss の共通部 (D-PARTY-001)。core を読み、モンスターを入れ、パーティの 1 戦を回す。
 * 仲間の手は core の allyAutoAction (resolveTurnMulti の中で動く)。主人公の手は群れなら全体技 → 一番弱い敵に
 * 1 対 1 の autoBattleAction、1 対 1 なら autoBattleAction。主人公が倒れたら負け (core)。
 * 仲間は自分の Lv (主人公の Lv + MATE_LV) で戦い、XP/戦は主人公の取り分 (人数で等分。D-PARTY-002 §11)。
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
/** ITEMS_JSON = `node scripts/admin-data.mjs get items` の出力 (戦闘のどうぐ)。無ければ同梱の品。 */
if (process.env.ITEMS_JSON) { const v = JSON.parse(readFileSync(process.env.ITEMS_JSON, 'utf8')).value; core.setItemOverrides({ items: core.decodeItemsFromRecord(v.items), equipment: v.equipment }); }

const { startBattle, resolveTurn, resolveTurnMulti, autoBattleAction, skillMpCostOf, battleXpFor, partyMembers, splitBattleXp, SKILLS, BATTLE_TUNING } = core;
/** 仲間の Lv = 主人公の Lv + MATE_LV (★の上乗せを試す。D-PARTY-002 §8。仲間は自分の Lv で戦う §11)。 */
const MATE_LV = Number(process.env.MATE_LV ?? 0);
type Archetype = import('../packages/core/src/index.js').Archetype;
type BattleState = import('../packages/core/src/index.js').BattleState;

/** 仲間の組み合わせ (主人公を除く)。 */
export const PARTIES: Record<string, Archetype[]> = { solo: [], duo: ['warrior'], trio: ['warrior', 'miko'], full: ['warrior', 'mage', 'miko'] };
const isAoe = (k: string) => !!SKILLS[k]?.effects.some((e) => e.target === 'allEnemies' && (e.kind === 'damage' || e.kind === 'fixedDamage'));
/** 主人公の装備 (仲間の PARTY_ARMOR と同じ段階)。 */
const heroGear = (lv: number) => (lv >= core.PARTY_ARMOR.fromLevel ? [core.PARTY_ARMOR.id] : []);

export interface PartyCarry { hp: number; mp: number; herbs: number; mates: Record<string, number>; matesMp: Record<string, number> }
export interface FightOpts {
  monsterId?: string; story?: boolean; extraEnemies?: number; group?: boolean; carry?: PartyCarry; tonics?: number;
  /** 主人公の装備 (個体。属性装備の列 D-ELEM-001)。あれば heroGear の簡易形の代わりに使う。 */
  gear?: import('../packages/core/src/index.js').GearSelection;
  /** 持ちこむ戦闘のどうぐ (id → 数)。主人公は手が空いたターン (やくそう・ためへの防御・全体技を使わないとき) に先頭から使う (ボスの糸口 §12)。 */
  battleItems?: Record<string, number>;
}

/** 1 戦。edge の sealEncounter と同じく、仲間を allies に並べる (ボスの HP は仲間の数で変えない。D-PARTY-002 §12)。 */
export function fight(job: Archetype, lv: number, tier: number, seed: number, mates: readonly Archetype[], o: FightOpts) {
  const herbs = o.carry?.herbs ?? BATTLE_TUNING.herbCarryMax;
  let s: BattleState = startBattle(job, lv, 1, 'hero', tier as never, seed >>> 0, herbs, o.carry ? { hp: o.carry.hp, mp: o.carry.mp } : undefined, {
    tonics: o.tonics ?? BATTLE_TUNING.tonicCarryMax, ...(o.extraEnemies !== undefined ? { extraEnemies: o.extraEnemies } : {}), ...(o.group ? { group: true } : {}), vitalsVariance: BATTLE_TUNING.monsterVitalsVariance, ...(o.gear ? { gear: o.gear } : { equipIds: heroGear(lv) }),
    ...(o.monsterId ? { monsterId: o.monsterId } : {}), ...(o.story ? { story: { canFlee: false } } : {}), ...(o.battleItems ? { battleItems: o.battleItems } : {}),
  });
  const defs = mates.map((a, i) => ({ id: `m${i}`, name: `mate${i}`, archetype: a, level: Math.max(1, lv + MATE_LV) }));
  const members = partyMembers(defs, lv, o.carry ? { hp: o.carry.mates, mp: o.carry.matesMp } : {});
  if (members.length) {
    const enemies = s.enemies ?? [s.monster];
    s = { ...s, allies: [s.player, ...members.map((m) => m.combatant)], enemies };
  }
  const multi = (s.enemies?.length ?? 1) > 1 || (s.allies?.length ?? 1) > 1;
  let turns = 0;
  for (let i = 0; i < 80 && s.outcome === 'ongoing'; i++) {
    turns++;
    // 魔法反射の敵には、ダメージのどうぐ (呪文と同じ doMagic) を使わない (D-PARTY-002 §12a。人は見て待つ)。
    const reflecting = (s.enemies ?? [s.monster]).some((e) => e.hp > 0 && (e.statuses ?? []).some((x) => x.id === 'magicReflect'));
    const item = Object.entries(s.battleItems ?? {}).find(([id, n]) => n > 0 && !(reflecting && core.ITEMS[id]?.battle?.effects.some((e) => e.kind === 'fixedDamage')))?.[0];
    const hurt = s.herbs > 0 && s.player.hp < s.player.maxHp * 0.45;
    if (!multi) {
      if (item && !hurt && !s.monster.charging) { s = resolveTurn(s, 'item', undefined, 0, item); continue; }
      const a = autoBattleAction(s); s = resolveTurn(s, a.command, undefined, a.skillIndex); continue;
    }
    const living = (s.enemies ?? [s.monster]).filter((e) => e.hp > 0);
    const p = s.player; const cost = skillMpCostOf(p);
    const aoe = s.playerSkills.findIndex((k) => isAoe(k.kind));
    if (living.length >= 2 && aoe >= 0 && p.mp >= cost && !(s.herbs > 0 && p.hp < p.maxHp * 0.45)) { s = resolveTurnMulti(s, 'skill', undefined, aoe, 0); continue; }
    const tgt = living.reduce((a, b) => (b.hp < a.hp ? b : a));
    if (item && !hurt && !living.some((e) => e.charging)) { s = resolveTurnMulti(s, 'item', undefined, 0, core.itemTargetsOneAlly(item) ? 0 : living.indexOf(tgt), item); continue; }
    const view = { ...s, monster: tgt } as BattleState; delete view.allies; delete view.enemies;
    let a = autoBattleAction(view);
    if (living.some((e) => e.charging) && a.command !== 'skill') a = { command: 'guard', skillIndex: 0 };
    // やくそう・しずく・1 人回復のとくぎは味方の番号 (D-PARTY-003)。1 対 1 の先読みで選んだ手なので主人公 (0) に。
    const selfAim = a.command === 'herb' || a.command === 'tonic' || (a.command === 'skill' && core.skillTargetsOneAlly(s.playerSkills[a.skillIndex]?.kind ?? ''));
    s = resolveTurnMulti(s, a.command, undefined, a.skillIndex, selfAim ? 0 : living.indexOf(tgt));
  }
  const killed = (s.enemies ?? [s.monster]).filter((e) => e.hp <= 0).map((e) => e.monsterId ?? s.monsterId);
  const mates2: Record<string, number> = { ...o.carry?.mates }, matesMp: Record<string, number> = { ...o.carry?.matesMp };
  members.forEach((m, i) => { const c = s.allies![i + 1]!; mates2[m.id] = c.hp; matesMp[m.id] = c.mp; });
  const total = s.outcome === 'win' ? killed.reduce((n, id) => n + battleXpFor(id), 0) : 0;
  // xp は主人公の取り分 (戦闘に出た人数で等分。§11)。
  return { outcome: s.outcome, turns, xp: splitBattleXp(total, 1 + members.length),
    carry: { hp: s.player.hp, mp: s.player.mp, herbs: s.herbs, mates: mates2, matesMp } satisfies PartyCarry };
}

export const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!;
export const minOf = (v: number[]) => Math.min(...v);
