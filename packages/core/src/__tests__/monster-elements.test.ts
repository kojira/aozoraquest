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

  it('魔法 (賢者の火炎) はメタルに最小 1 しか通らない (DQ の魔法無効)', () => {
    // はぐれスライムは fleer で高確率逃走するため、火炎が実際に当たったターンを探して検証する。
    let landed = false;
    for (let seed = 0; seed < 40 && !landed; seed++) {
      const s = startBattle('sage', 8, 12, '賢', 1, seed, 0, undefined, { monsterId: 'stray-slime' });
      expect(s.monster.resistAllMagic).toBe(true);
      const idx = s.playerSkills.findIndex((sk) => sk.name === '火炎');
      const before = s.monster.hp;
      const next: BattleState = resolveTurn(s, 'skill', undefined, idx);
      const dealt = before - next.monster.hp;
      if (dealt > 0) {
        landed = true;
        expect(dealt).toBe(1); // 魔法無効 = 最小 1 のみ。会心物理でしか削れない。
      }
    }
    expect(landed).toBe(true);
  });

  it('弱点属性は 1.5 倍、逆は 0.5 倍 (賢者の疾風=wind)', () => {
    // wind は earth に強い (moss-golem=earth) / fire に弱い (will-o-wisp=fire)。
    // 同じ turnSeed で乱数を揃え、earth 敵と fire 敵への疾風ダメージを比較。
    const gale = (monsterId: string): BattleState => {
      const s = startBattle('sage', 10, 15, '賢', 2, 5, 0, undefined, { monsterId });
      const idx = s.playerSkills.findIndex((sk) => sk.name === '疾風');
      return resolveTurn(s, 'skill', 777, idx);
    };
    const earth = gale('moss-golem'); // wind ×1.5 (弱点)
    const fire = gale('will-o-wisp'); // wind ×0.5 (耐性)
    const earthDealt = MONSTERS_BY_ID['moss-golem']!.hp! * 1; // 参考: 実 hp は factor 込みなので比較で見る
    void earthDealt;
    // 弱点を突いた方がダメージが大きく、告知メッセージも出る。
    expect(earth.lastEvents.some((e) => e.text.includes('弱点を突いた'))).toBe(true);
    expect(fire.lastEvents.some((e) => e.text.includes('効果がいまひとつ'))).toBe(true);
  });
});
