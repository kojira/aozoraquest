import { describe, it, expect } from 'vitest';
import { SKILLS, runSkill, EFFECT_HANDLERS, type SkillContext } from '../skills.js';
import type { Combatant, AttackOptions } from '../battle.js';

function makeCombatant(over: Partial<Combatant> = {}): Combatant {
  return {
    name: 'test',
    maxHp: 100,
    hp: 100,
    maxMp: 20,
    mp: 20,
    atk: 20,
    def: 10,
    agi: 15,
    int: 25,
    luk: 30,
    guarding: false,
    parrying: false,
    charging: false,
    focus: 0,
    ...over,
  };
}

/** doAttack をスパイに差し替え、SKILLS が「どんな opts で何回 doAttack を呼ぶか」を検証する。 */
function runWithSpy(skillId: string, attacker: Combatant, defender: Combatant, rng = () => 0.5) {
  const calls: AttackOptions[] = [];
  const ctx: SkillContext = {
    attacker,
    defender,
    rng,
    events: [],
    skillName: skillId,
    engine: {
      doAttack: (_a, _d, _r, _e, _actor, opts = {}) => {
        calls.push(opts);
      },
    },
  };
  runSkill(SKILLS[skillId], ctx);
  return { calls, ctx };
}

describe('とくぎプラグイン基盤 (#452)', () => {
  it('既存 6 種すべてが SKILLS に登録されている', () => {
    for (const id of ['smash', 'parry', 'flurry', 'spell', 'gamble', 'heal']) {
      expect(SKILLS[id], id).toBeDefined();
      expect(SKILLS[id].id).toBe(id);
    }
  });

  it('smash: atk 基準 1.7 倍・hitBonus -0.1 で 1 回', () => {
    const { calls } = runWithSpy('smash', makeCombatant(), makeCombatant());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ power: 1.7, hitBonus: -0.1 });
    expect(calls[0].useInt).toBeUndefined();
    expect(calls[0].atkOverride).toBeUndefined(); // 素の atk
  });

  it('parry: 効果なし (宣言は resolveTurn 側)', () => {
    const { calls } = runWithSpy('parry', makeCombatant(), makeCombatant());
    expect(calls).toHaveLength(0);
  });

  it('flurry: agi 基準 0.65 倍を 2 撃', () => {
    const atk = makeCombatant({ agi: 15 });
    const { calls } = runWithSpy('flurry', atk, makeCombatant());
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c).toMatchObject({ power: 0.65, atkOverride: 15 });
  });

  it('flurry: 1 撃目で対象が倒れたら 2 撃目は撃たない', () => {
    const dead = makeCombatant({ hp: 0 });
    const { calls } = runWithSpy('flurry', makeCombatant(), dead);
    expect(calls).toHaveLength(0); // 開始時点で hp<=0 なら 0 撃
  });

  it('spell: int 基準 (useInt) ・防御半減 (defFactor 0.5)', () => {
    const { calls } = runWithSpy('spell', makeCombatant(), makeCombatant());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ power: 1.0, useInt: true, defFactor: 0.5 });
  });

  it('gamble: luk 基準・power は floor〜max で抽選 (rng で変わる)', () => {
    const atk = makeCombatant({ luk: 30 }); // floor = min(0.6, 30*0.012=0.36) = 0.36
    const lo = runWithSpy('gamble', atk, makeCombatant(), () => 0).calls[0];
    const hi = runWithSpy('gamble', atk, makeCombatant(), () => 1).calls[0];
    expect(lo.atkOverride).toBe(30);
    expect(lo.power).toBeCloseTo(0.36); // rng=0 → floor
    expect(hi.power).toBeCloseTo(2.6); // rng=1 → max
  });

  it('heal: doAttack を呼ばず maxHp の 0.35 回復 (上限クランプ)', () => {
    const atk = makeCombatant({ maxHp: 100, hp: 50 });
    const { calls, ctx } = runWithSpy('heal', atk, makeCombatant());
    expect(calls).toHaveLength(0); // 攻撃しない
    expect(atk.hp).toBe(85); // 50 + round(100*0.35)=85
    expect(ctx.events.some((e) => e.text.includes('回復'))).toBe(true);
  });

  it('heal: maxHp を超えない', () => {
    const atk = makeCombatant({ maxHp: 100, hp: 90 });
    runWithSpy('heal', atk, makeCombatant());
    expect(atk.hp).toBe(100);
  });

  it('EFFECT_HANDLERS は damage/heal をカバー', () => {
    expect(EFFECT_HANDLERS.damage).toBeTypeOf('function');
    expect(EFFECT_HANDLERS.heal).toBeTypeOf('function');
  });
});
