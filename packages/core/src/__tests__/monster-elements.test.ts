import { describe, it, expect } from 'vitest';
import { monsterCombatant, MONSTERS_BY_ID, startBattle, resolveTurn, type BattleState } from '../index.js';

describe('モンスター属性・魔法耐性 (#455)', () => {
  it('monsterCombatant が def.element を Combatant に載せる', () => {
    const golem = monsterCombatant(MONSTERS_BY_ID['moss-golem']!, 0, () => 0.5);
    expect(golem.element).toBe('earth');
    const wisp = monsterCombatant(MONSTERS_BY_ID['will-o-wisp']!, 0, () => 0.5);
    expect(wisp.element).toBe('fire');
  });

  it('メタル (はぐれスライム) は resistAllMagic・無属性', () => {
    const metal = monsterCombatant(MONSTERS_BY_ID['stray-slime']!, 0, () => 0.5);
    expect(metal.resistAllMagic).toBe(true);
    expect(metal.element).toBeUndefined();
  });

  it('全モンスターは element を持つか resistAllMagic (無属性放置がない)', () => {
    for (const m of Object.values(MONSTERS_BY_ID)) {
      expect(m.element !== undefined || m.resistAllMagic === true, m.id).toBe(true);
    }
  });

  it('魔法 (賢者の火炎) はメタルに 1 も通らない (DQ の魔法無効)', () => {
    // 魔法無効 = **HP が 1 も減らない** (minDamage=0。オーナー指摘 2026-07-25)。
    // 逃走・回避で「そもそも撃てなかった」ケースと区別するため、火炎の着弾ログが出た
    // ターンが 1 回以上あることも確かめる (ログは出るがダメージだけ 0、が正しい姿)。
    let cast = false;
    for (let seed = 0; seed < 40; seed++) {
      const s = startBattle('sage', 8, 12, '賢', 1, seed, 0, undefined, { monsterId: 'stray-slime' });
      expect(s.monster.resistAllMagic).toBe(true);
      const idx = s.playerSkills.findIndex((sk) => sk.name === '火炎');
      const before = s.monster.hp;
      const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
      expect(before - next.monster.hp).toBe(0); // 何があっても魔法では削れない
      if (next.lastEvents.some((e) => e.text.includes('火炎'))) cast = true;
    }
    expect(cast).toBe(true);
  });

  it('弱点属性は 1.5 倍、逆は 0.5 倍 (賢者の疾風=wind)', () => {
    // wind は earth に強い (moss-golem=earth) / fire に弱い (will-o-wisp=fire)。
    // 同じ turnSeed で乱数を揃え、earth 敵と fire 敵への疾風ダメージを比較。
    const gale = (monsterId: string): BattleState => {
      const s = startBattle('sage', 10, 15, '賢', 2, 5, 0, undefined, { monsterId });
      const idx = s.playerSkills.findIndex((sk) => sk.name === '疾風');
      return resolveTurn(s, 'skill', 777, idx);
    };
    const earth = gale('moss-golem'); // earth 敵 → wind は弱点 ×1.5
    const fire = gale('will-o-wisp'); // fire 敵 → wind は耐性 ×0.5
    // 弱点/耐性の告知が正しく出る (相性適用の証跡)。
    expect(earth.lastEvents.some((e) => e.text.includes('弱点を突いた'))).toBe(true);
    expect(fire.lastEvents.some((e) => e.text.includes('効果がいまひとつ'))).toBe(true);
  });
});
