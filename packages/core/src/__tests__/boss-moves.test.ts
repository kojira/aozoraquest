/**
 * ボスの技 (D-PARTY-002 §12a): 全体の呪文・弱体と自分への強化 (debuffer)・魔法反射・とげの盾・MP。
 * - 全体の呪文は生きている味方全員に当たる。1 人戦は今までどおり主人公 1 人
 * - 全体は 2 ターン続けない (lastAoe)
 * - 弱体は味方全員／1 人戦の主人公に付き、治療のどうぐ (cleanse) で消える
 * - 自分への強化: magicReflect は呪文をはね返し、thorns は物理をはね返す
 * - 技ごとに MP を払い、足りない技は選ばない。MP が尽きたら通常攻撃だけ
 * - 検証
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BATTLE_TUNING, activeEquipment, activeItems, resolveTurn, resolveTurnMulti, setItemOverrides, setMonsterOverrides, startBattle,
  type BattleState, type Combatant, type ItemDefData, type MonsterDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const BASE: MonsterDef = { id: 'mboss', name: 'わざのぬし', species: 'golem', level: 5, tier: 1, stats: [5, 5, 5, 20, 5], hp: 999, mp: 200, drops: [], intro: 'わざのぬしが あらわれた。' };
const AOE_SPELL = { name: 'ねっぷう', min: 4, max: 4, target: 'all' as const };
const always = { castChance: 1, debuffChance: 1 };
const DOKUKESHI: ItemDefData = { id: 'test-cure', name: 'なおしそう', battle: { effects: [{ kind: 'cleanse', target: 'self' }] } };

afterEach(() => { setMonsterOverrides(TEST_MONSTERS); setItemOverrides(null); });

function solo(def: Partial<MonsterDef>, seed = 3, items?: Record<string, number>): BattleState {
  setMonsterOverrides([...TEST_MONSTERS, { ...BASE, ...def } as MonsterDef]);
  return startBattle('warrior', 5, 5, '勇者', 1, seed, 0, undefined, { monsterId: 'mboss', ...(items ? { battleItems: items } : {}) });
}
function party(def: Partial<MonsterDef>, seed = 3): BattleState {
  const s = solo(def, seed);
  const mate = (name: string): Combatant => ({ ...s.player, name, statuses: [] });
  return { ...s, allies: [s.player, mate('なかまA'), mate('なかまB')], enemies: [s.monster] };
}
const has = (c: Combatant, id: string) => (c.statuses ?? []).some((x) => x.id === id);
/** 呪文の 1 発ごとの告知 (「〇〇のねっぷう! 勇者に4のダメージ」) の数。 */
const spellHits = (s: BattleState, label: string) => s.lastEvents.filter((e) => e.actor === 'monster' && e.text.includes(`の${label}! `) && e.text.includes('ダメージ')).length;

describe('全体の呪文 (spell.target)', () => {
  it("target 'all' は 3 人の味方全員に当たり、MP は単体の monsterAoeMpFactor 倍", () => {
    const s0 = party({ abilities: ['caster'], spell: AOE_SPELL, abilityParams: always });
    const s1 = resolveTurnMulti(s0, 'guard', 11);
    expect(spellHits(s1, 'ねっぷう')).toBe(3);
    s1.allies!.forEach((a, i) => expect(a.hp).toBeLessThan(s0.allies![i]!.hp));
    expect(s0.enemies![0]!.mp - s1.enemies![0]!.mp).toBe(BATTLE_TUNING.monsterCastMpCost * BATTLE_TUNING.monsterAoeMpFactor);
  });

  it('1 人戦では主人公 1 人に当たり、単体の呪文と同じ乱数・同じダメージ', () => {
    const one = resolveTurn(solo({ abilities: ['caster'], spell: { ...AOE_SPELL, target: undefined } as never, abilityParams: always }), 'guard', 11);
    const all = resolveTurn(solo({ abilities: ['caster'], spell: AOE_SPELL, abilityParams: always }), 'guard', 11);
    expect(spellHits(all, 'ねっぷう')).toBe(1);
    expect(all.player.hp).toBe(one.player.hp);
  });

  it('全体は 2 ターン続けない (長い戦いで連続 0 回、全体は出る)', () => {
    let s = party({ abilities: ['caster'], spell: AOE_SPELL, abilityParams: always, mp: 9999 }, 5);
    s = { ...s, allies: s.allies!.map((a) => ({ ...a, hp: 99999, maxHp: 99999 })), player: { ...s.player, hp: 99999, maxHp: 99999 } };
    s = { ...s, allies: [s.player, ...s.allies!.slice(1)] };
    let prev = false, aoe = 0;
    for (let t = 0; t < 60 && s.outcome === 'ongoing'; t++) {
      s = resolveTurnMulti(s, 'guard', 1000 + t);
      const now = spellHits(s, 'ねっぷう') > 0;
      expect(prev && now).toBe(false);
      if (now) aoe++;
      prev = now;
    }
    expect(aoe).toBeGreaterThan(10);
  });
});

describe('弱体 (debuffer)', () => {
  it("target 'all' の弱体は 3 人に付き、MP を全体ぶん払う", () => {
    const s0 = party({ abilities: ['debuffer'], debuffs: [{ name: 'ねっぷう', status: 'atkDown', chance: 1, turns: 3, target: 'all' }], abilityParams: always });
    const s1 = resolveTurnMulti(s0, 'guard', 11);
    expect(s1.allies!.every((a) => has(a, 'atkDown'))).toBe(true);
    expect(s1.lastEvents.filter((e) => e.text.endsWith('の攻撃力がさがった!'))).toHaveLength(3);
    expect(s0.enemies![0]!.mp - s1.enemies![0]!.mp).toBe(BATTLE_TUNING.monsterDebuffMpCost * BATTLE_TUNING.monsterAoeMpFactor);
  });

  it('1 人戦でも主人公に付き、治療のどうぐ (cleanse) で消える', () => {
    setItemOverrides({ items: [...activeItems(), DOKUKESHI], equipment: [...activeEquipment()] });
    const s0 = solo({ abilities: ['debuffer'], debuffs: [{ name: 'こだまの さけび', status: 'poison', chance: 1, turns: 4, magnitude: 1 }], abilityParams: always }, 3, { 'test-cure': 1 });
    const s1 = resolveTurn(s0, 'guard', 11);
    expect(has(s1.player, 'poison')).toBe(true);
    expect(s0.monster.mp - s1.monster.mp).toBe(BATTLE_TUNING.monsterDebuffMpCost);
    const s2 = resolveTurn({ ...s1, monster: { ...s1.monster, mp: 0 } }, 'item', 12, 0, 'test-cure');
    expect(has(s2.player, 'poison')).toBe(false);
    expect(s2.lastEvents.some((e) => e.text === `${s0.player.name}の状態異常が回復した!`)).toBe(true);
  });

  it('付いている状態の技は使わず、次の技へ (自分への強化)', () => {
    const def = { abilities: ['debuffer' as const], debuffs: [{ name: 'しびれ', status: 'stun' as const, chance: 1, turns: 1 }, { name: 'とげ', status: 'thorns' as const, chance: 1, turns: 3, target: 'self' as const }], abilityParams: always };
    const s0 = solo(def);
    const stunned = { ...s0, player: { ...s0.player, statuses: [{ id: 'stun' as const, turns: 3 }] } };
    const s1 = resolveTurn(stunned, 'guard', 11);
    expect(has(s1.monster, 'thorns')).toBe(true);
  });
});

describe('自分への強化: 反射', () => {
  it('magicReflect は呪文をはね返す (本人は無傷・術者が受ける)', () => {
    const s0 = solo({});
    const reflecting = { ...s0, monster: { ...s0.monster, statuses: [{ id: 'magicReflect' as const, turns: 3 }] } };
    const mageState = { ...reflecting, playerSkills: [{ kind: 'mage-flame', name: '火炎術式' }] } as BattleState;
    const s1 = resolveTurn(mageState, 'skill', 11, 0);
    expect(s1.monster.hp).toBe(s0.monster.hp);
    expect(s1.player.hp).toBeLessThan(s0.player.hp);
    expect(s1.lastEvents.some((e) => e.text.startsWith('呪文は はね返された!'))).toBe(true);
  });

  it('ボスが自分にかけた thorns は物理攻撃をはね返す', () => {
    const s0 = solo({ abilities: ['debuffer'], debuffs: [{ name: 'いばらの よろい', status: 'thorns', chance: 1, turns: 3, target: 'self' }], abilityParams: always, stats: [0, 5, 0, 20, 5] });
    let s = resolveTurn(s0, 'guard', 11);
    expect(has(s.monster, 'thorns')).toBe(true);
    expect(s.lastEvents.some((e) => e.text === `${s0.monster.name}は とげの盾を構えた!` || e.text === `${s0.monster.name}はとげの盾を構えた!`)).toBe(true);
    const hp = s.player.hp;
    s = resolveTurn({ ...s, monster: { ...s.monster, mp: 0 } }, 'attack', 13);
    expect(s.lastEvents.some((e) => e.text.startsWith(`${s0.player.name}はとげに`))).toBe(true);
    expect(s.player.hp).toBeLessThan(hp);
  });
});

describe('MP', () => {
  it('MP が足りない技は選ばない。MP 0 のボスは通常攻撃だけ', () => {
    const def = { abilities: ['caster' as const, 'debuffer' as const, 'charger' as const], spell: AOE_SPELL, chargedTarget: 'all' as const, debuffs: [{ name: 'ねっぷう', status: 'atkDown' as const, chance: 1, turns: 3, target: 'all' as const }], abilityParams: { ...always, chargeChance: 1 }, mp: BATTLE_TUNING.monsterCastMpCost * 2 - 1 };
    let s = party(def, 4);
    s = { ...s, allies: s.allies!.map((a) => ({ ...a, hp: 99999, maxHp: 99999 })) };
    s = { ...s, player: s.allies![0]! };
    // 全体呪文 (12) にも全体弱体 (10) にも足りる MP 11 → 全体呪文は撃たない
    const first = resolveTurnMulti(s, 'guard', 21);
    expect(spellHits(first, 'ねっぷう')).toBe(0);
    let z: BattleState = { ...s, enemies: [{ ...s.enemies![0]!, mp: 0 }] };
    z = { ...z, monster: z.enemies![0]! };
    for (let t = 0; t < 20; t++) {
      z = resolveTurnMulti(z, 'guard', 300 + t);
      const mine = z.lastEvents.filter((e) => e.actor === 'monster');
      expect(mine.some((e) => e.text.includes('ねっぷう') || e.text.includes('力をためている'))).toBe(false);
    }
  });
});

describe('検証', () => {
  const bad = (d: Partial<MonsterDef>) => () => setMonsterOverrides([...TEST_MONSTERS, { ...BASE, ...d } as MonsterDef]);
  it('debuffs・target・chargedTarget を検証する', () => {
    expect(bad({ abilities: ['debuffer'] })).toThrow(/debuffs/);
    expect(bad({ abilities: ['debuffer'], debuffs: [{ name: 'x', status: 'nope' as never, chance: 1, turns: 2 }] })).toThrow(/status/);
    expect(bad({ debuffs: [{ name: 'x', status: 'sleep', chance: 2, turns: 2 }] })).toThrow(/chance/);
    expect(bad({ debuffs: [{ name: 'x', status: 'sleep', chance: 1, turns: 0 }] })).toThrow(/turns/);
    expect(bad({ debuffs: [{ name: 'x', status: 'sleep', chance: 1, turns: 2, target: 'both' as never }] })).toThrow(/target/);
    expect(bad({ debuffs: [1, 2, 3].map(() => ({ name: 'x', status: 'sleep' as const, chance: 1, turns: 2 })) })).toThrow(/debuffs/);
    expect(bad({ abilities: ['caster'], spell: { ...AOE_SPELL, target: 'many' as never } })).toThrow(/spell/);
    expect(bad({ chargedTarget: 'many' as never })).toThrow(/chargedTarget/);
    expect(bad({ abilities: ['debuffer', 'caster'], spell: AOE_SPELL, chargedTarget: 'all', debuffs: [{ name: 'x', status: 'magicReflect', chance: 1, turns: 2, target: 'self' }] })).not.toThrow();
  });
});
