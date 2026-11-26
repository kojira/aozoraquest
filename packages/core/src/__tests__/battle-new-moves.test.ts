/**
 * D-BALANCE-002 案D の新しい仕組み 3 つ (battle-group-buff / battle-element-immunity / battle-self-destruct)。
 * - 群れの強化 (debuffs の target 'allies'): 群れの生きている敵みんなに付く。1 体の戦いでは自分だけ
 * - 属性の無効 (immune): その属性の物理・呪文は 0。無属性の攻撃は効く
 * - 自爆 (selfDestruct): HP が below を下回った手番は前ぶれだけ、つぎの手番で味方みんなに大技、自分は倒れる
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveTurn, resolveTurnMulti, setMonsterOverrides, startBattle, MonsterDataError,
  type BattleState, type Combatant, type MonsterDef, type TurnEvent,
} from '../index.js';
import { doAttack, doMagic } from '../battle-attack.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const BASE: MonsterDef = { id: 'nm', name: 'あたらしいてき', species: 'golem', level: 9, tier: 3, stats: [20, 10, 1, 20, 5], hp: 60, mp: 99, drops: [], xp: 30, intro: 'て。' };
afterEach(() => setMonsterOverrides(TEST_MONSTERS));

function battle(def: Partial<MonsterDef>, extra = 0, seed = 3): BattleState {
  setMonsterOverrides([...TEST_MONSTERS, { ...BASE, ...def } as MonsterDef]);
  return startBattle('warrior', 12, 12, '勇者', 3, seed, 0, undefined, { monsterId: 'nm', extraEnemies: extra });
}
const has = (c: Combatant, id: string) => (c.statuses ?? []).some((x) => x.id === id);

describe("群れの強化 (debuffs の target 'allies')", () => {
  const rally = { abilities: ['debuffer' as const], abilityParams: { debuffChance: 1 }, debuffs: [{ name: 'ときのこえ', status: 'defUp' as const, chance: 1, turns: 3, target: 'allies' as const }] };

  it('群れの生きている敵みんなに付く (ほかの敵の種類はちがっても)', () => {
    const s0 = battle(rally, 2);
    expect(s0.enemies).toHaveLength(3);
    const s1 = resolveTurnMulti(s0, 'guard', 11);
    expect(s1.lastEvents.some((e) => e.text.includes('ときのこえ'))).toBe(true);
    expect(s1.enemies!.every((e) => has(e, 'defUp'))).toBe(true);
    expect(has(s1.allies![0]!, 'defUp')).toBe(false);
  });

  it('1 体の戦いでは自分だけに付く', () => {
    const s1 = resolveTurn(battle(rally), 'guard', 11);
    expect(has(s1.monster, 'defUp')).toBe(true);
    expect(has(s1.player, 'defUp')).toBe(false);
  });

  it('みんなに付いていれば使わない (通常攻撃に回る)', () => {
    let s = battle(rally, 1);
    s = resolveTurnMulti(s, 'guard', 11);
    const again = resolveTurnMulti(s, 'guard', 12);
    expect(again.lastEvents.some((e) => e.text.includes('ときのこえ'))).toBe(false);
  });
});

describe('属性の無効 (immune)', () => {
  it('その属性の呪文は 0 ダメージで「まったく 効かない!」、ちがう属性と無属性は効く', () => {
    const s = battle({ immune: ['fire'] });
    const hit = (element?: 'fire' | 'water') => {
      const target = { ...s.monster };
      const events: TurnEvent[] = [];
      doMagic(s.player, target, () => 0.5, events, 'player', { amount: 20, ...(element ? { element } : {}) });
      return { dmg: s.monster.hp - target.hp, events };
    };
    const fire = hit('fire');
    expect(fire.dmg).toBe(0);
    expect(fire.events.some((e) => e.text === `${s.monster.name}には まったく 効かない!`)).toBe(true);
    expect(hit('water').dmg).toBeGreaterThan(0);
    expect(hit().dmg).toBeGreaterThan(0);
  });

  it('その属性の武器の通常攻撃も 0、無属性の物理は効く', () => {
    const s = battle({ immune: ['fire'] });
    const swing = (element?: 'fire') => {
      const target = { ...s.monster, guarding: false };
      doAttack({ ...s.player, atk: 80 }, target, () => 0.3, [], 'player', element ? { element } : {});
      return s.monster.hp - target.hp;
    };
    expect(swing('fire')).toBe(0);
    expect(swing()).toBeGreaterThan(0);
  });

  it('不正な属性・重複は保存できない', () => {
    expect(() => battle({ immune: ['holy' as never] })).toThrow(MonsterDataError);
    expect(() => battle({ immune: ['fire', 'fire'] })).toThrow(MonsterDataError);
  });
});

describe('自爆 (selfDestruct)', () => {
  const bomb = { abilities: ['selfDestruct' as const], selfDestruct: { name: 'だいばくはつ', tell: 'あやしく ふくらんでいる…!', below: 0.5, power: 2 } };

  it('HP が below を下回った手番は前ぶれだけ、つぎの手番で味方みんなに当てて自分は倒れる', () => {
    const s0 = battle(bomb, 0);
    const low = { ...s0, monster: { ...s0.monster, hp: Math.floor(s0.monster.maxHp * 0.4) } };
    const t1 = resolveTurn(low, 'guard', 11);
    expect(t1.lastEvents.some((e) => e.text === 'あやしく ふくらんでいる…!')).toBe(true);
    expect(t1.lastEvents.some((e) => e.text.includes('だいばくはつ'))).toBe(false);
    expect(t1.player.hp).toBe(low.player.hp);
    const t2 = resolveTurn(t1, 'guard', 12);
    expect(t2.lastEvents.some((e) => e.text.includes('だいばくはつ'))).toBe(true);
    expect(t2.player.hp).toBeLessThan(t1.player.hp);
    expect(t2.monster.hp).toBe(0);
    expect(t2.outcome).toBe('win');
  });

  it('HP が多いうちはふつうに動く (前ぶれは出ない)', () => {
    const t1 = resolveTurn(battle(bomb), 'guard', 11);
    expect(t1.lastEvents.some((e) => e.text === 'あやしく ふくらんでいる…!')).toBe(false);
  });

  it('群れでは味方みんなに当たる', () => {
    const s0 = battle(bomb, 0);
    const mate = { ...s0.player, name: 'なかま' };
    const st: BattleState = { ...s0, allies: [s0.player, mate], enemies: [{ ...s0.monster, hp: 5, fuse: true }], monster: { ...s0.monster, hp: 5, fuse: true } };
    const t = resolveTurnMulti(st, 'guard', 12);
    const hits = t.lastEvents.filter((e) => e.text.includes('だいばくはつ') && e.text.includes('ダメージ'));
    expect(hits.length).toBe(2);
    expect(t.enemies![0]!.hp).toBe(0);
  });

  it('能力に selfDestruct があるのに欄が無いと保存できない', () => {
    expect(() => battle({ abilities: ['selfDestruct'] })).toThrow(MonsterDataError);
    expect(() => battle({ ...bomb, selfDestruct: { name: 'x', tell: '' } })).toThrow(MonsterDataError);
  });
});
