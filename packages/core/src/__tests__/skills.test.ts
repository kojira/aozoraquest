import { describe, it, expect } from 'vitest';
import { SKILLS, runSkill, runSkillMulti, effectTarget, EFFECT_HANDLERS, type SkillContext, type SkillDef } from '../skills.js';
import type { Combatant, AttackOptions } from '../battle.js';
import type { CombatSides } from '../combat-target.js';

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
      doAttack: (_a, d, _r, _e, _actor, opts = {}) => {
        calls.push(opts);
        return { hit: d.hp > 0, damage: 5, fatal: false, crit: false };
      },
      doMagic: (_a, d) => ({ hit: d.hp > 0, damage: 5, fatal: false, crit: false }),
    },
  };
  runSkill(SKILLS[skillId]!, ctx);
  return { calls, ctx };
}

describe('とくぎプラグイン基盤 (#452)', () => {
  it('既存 6 種すべてが SKILLS に登録されている', () => {
    for (const id of ['smash', 'parry', 'flurry', 'spell', 'gamble', 'heal']) {
      expect(SKILLS[id], id).toBeDefined();
      expect(SKILLS[id]!.id).toBe(id);
    }
  });

  it('smash: atk 基準 1.7 倍・hitBonus -0.1 で 1 回', () => {
    const { calls } = runWithSpy('smash', makeCombatant(), makeCombatant());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ power: 1.7, hitBonus: -0.1 });
    expect(calls[0]!.useInt).toBeUndefined();
    expect(calls[0]!.atkOverride).toBeUndefined(); // 素の atk
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
    const lo = runWithSpy('gamble', atk, makeCombatant(), () => 0).calls[0]!;
    const hi = runWithSpy('gamble', atk, makeCombatant(), () => 1).calls[0]!;
    expect(lo.atkOverride).toBe(30);
    expect(lo.power).toBeCloseTo(0.36); // rng=0 → floor
    expect(hi.power).toBeCloseTo(2.6); // rng=1 → max
  });

  it('heal: doAttack を呼ばず maxHp の 0.35 回復 (上限クランプ)', () => {
    // heal は ctx.defender (解決済み対象) を回復する。runSkill 低レベル呼びでは 3 番目の引数が対象。
    const target = makeCombatant({ maxHp: 100, hp: 50 });
    const { calls, ctx } = runWithSpy('heal', makeCombatant(), target);
    expect(calls).toHaveLength(0); // 攻撃しない
    expect(target.hp).toBe(85); // 50 + round(100*0.35)=85
    expect(ctx.events.some((e) => e.text.includes('回復'))).toBe(true);
  });

  it('heal: maxHp を超えない', () => {
    const target = makeCombatant({ maxHp: 100, hp: 90 });
    runWithSpy('heal', makeCombatant(), target);
    expect(target.hp).toBe(100);
  });

  it('EFFECT_HANDLERS は damage/heal/status をカバー', () => {
    expect(EFFECT_HANDLERS.damage).toBeTypeOf('function');
    expect(EFFECT_HANDLERS.heal).toBeTypeOf('function');
    expect(EFFECT_HANDLERS.status).toBeTypeOf('function');
  });
});

/** 任意の SkillDef を spy エンジンで実行 (hit=defender.hp>0)。 */
function runDef(def: SkillDef, attacker: Combatant, defender: Combatant, rng = () => 0) {
  const ctx: SkillContext = {
    attacker,
    defender,
    rng,
    events: [],
    skillName: 'test',
    engine: {
      doAttack: (_a, d) => ({ hit: d.hp > 0, damage: 5, fatal: false, crit: false }),
      doMagic: (_a, d) => ({ hit: d.hp > 0, damage: 5, fatal: false, crit: false }),
    },
  };
  runSkill(def, ctx);
}

describe('効果 ↔ 状態異常の接続 (#452)', () => {
  it('status(self): 使用者にバフを付与', () => {
    const atk = makeCombatant();
    runDef({ id: 'x', effects: [{ kind: 'status', status: 'atkUp', target: 'self', turns: 3 }] }, atk, makeCombatant());
    expect(atk.statuses?.map((s) => s.id)).toContain('atkUp');
  });

  it('status(enemy): 相手にデバフを付与', () => {
    const def = makeCombatant();
    runDef({ id: 'x', effects: [{ kind: 'status', status: 'poison', target: 'enemy', turns: 3, magnitude: 4 }] }, makeCombatant(), def);
    expect(def.statuses?.find((s) => s.id === 'poison')?.magnitude).toBe(4);
  });

  it('status: chance=0 なら付与されない', () => {
    const def = makeCombatant();
    runDef({ id: 'x', effects: [{ kind: 'status', status: 'poison', target: 'enemy', chance: 0 }] }, makeCombatant(), def, () => 0.5);
    expect(def.statuses ?? []).toHaveLength(0);
  });

  it('inflict: 命中した攻撃に状態を乗せる (毒手)', () => {
    const def = makeCombatant({ hp: 100 });
    runDef(
      { id: 'x', effects: [{ kind: 'damage', stat: 'atk', power: 1, inflict: { status: 'poison', chance: 1, turns: 3, magnitude: 2 } }] },
      makeCombatant(),
      def,
    );
    expect(def.statuses?.some((s) => s.id === 'poison')).toBe(true);
  });

  it('inflict: 対象が既に倒れている (miss) なら状態を乗せない', () => {
    const dead = makeCombatant({ hp: 0 });
    runDef(
      { id: 'x', effects: [{ kind: 'damage', stat: 'atk', power: 1, inflict: { status: 'poison', chance: 1 } }] },
      makeCombatant(),
      dead,
    );
    expect(dead.statuses ?? []).toHaveLength(0);
  });

  it('element: damage 効果が攻撃属性を AttackOptions に渡す (doAttack が相性判定に使う)', () => {
    const { calls } = runWithSpy2({ id: 'x', effects: [{ kind: 'damage', stat: 'int', element: 'fire' }] });
    expect(calls[0]!.element).toBe('fire');
  });

  it('element: 未指定なら opts.element も undefined (無属性=等倍)', () => {
    const { calls } = runWithSpy2({ id: 'x', effects: [{ kind: 'damage', stat: 'atk' }] });
    expect(calls[0]!.element).toBeUndefined();
  });
});

/** 任意の SkillDef を spy で実行し、doAttack に渡った opts 列を返す。 */
function runWithSpy2(def: SkillDef, rng = () => 0.5) {
  const calls: AttackOptions[] = [];
  runSkill(def, {
    attacker: makeCombatant(),
    defender: makeCombatant(),
    rng,
    events: [],
    skillName: 'x',
    engine: {
      doAttack: (_a, d, _r, _e, _actor, opts = {}) => {
        calls.push(opts);
        return { hit: d.hp > 0, damage: 5, fatal: false, crit: false };
      },
      doMagic: (_a, d) => ({ hit: d.hp > 0, damage: 5, fatal: false, crit: false }),
    },
  });
  return { calls };
}

/** fixedDamage を spy で実行し、doMagic に渡った opts (amount/element) を返す。 */
function runMagicSpy(def: SkillDef, attacker: Combatant, defender: Combatant, rng = () => 0.5) {
  const calls: Array<{ amount: number; element?: string }> = [];
  runSkill(def, {
    attacker,
    defender,
    rng,
    events: [],
    skillName: 'x',
    engine: {
      doAttack: (_a, d) => ({ hit: d.hp > 0, damage: 5, fatal: false, crit: false }),
      doMagic: (_a, d, _r, _e, _actor, opts) => {
        calls.push(opts);
        return { hit: d.hp > 0, damage: opts.amount, fatal: false, crit: false };
      },
    },
  });
  return { calls };
}

describe('fixedDamage (範囲魔法 #456)', () => {
  it('min〜max の範囲でロールし doMagic に渡す (rng=0 で min)', () => {
    const { calls } = runMagicSpy({ id: 'x', effects: [{ kind: 'fixedDamage', min: 15, max: 20 }] }, makeCombatant(), makeCombatant(), () => 0);
    expect(calls[0]!.amount).toBe(15);
  });

  it('rng≈1 で max 近辺', () => {
    const { calls } = runMagicSpy({ id: 'x', effects: [{ kind: 'fixedDamage', min: 15, max: 20 }] }, makeCombatant(), makeCombatant(), () => 0.999);
    expect(calls[0]!.amount).toBe(20);
  });

  it('intBonus: +attacker.int × intBonus を加算', () => {
    const atk = makeCombatant({ int: 25 });
    const { calls } = runMagicSpy({ id: 'x', effects: [{ kind: 'fixedDamage', min: 10, max: 10, intBonus: 0.4 }] }, atk, makeCombatant(), () => 0);
    expect(calls[0]!.amount).toBe(10 + 25 * 0.4); // 20
  });

  it('element を doMagic に渡す (属性相性)', () => {
    const { calls } = runMagicSpy({ id: 'x', effects: [{ kind: 'fixedDamage', min: 5, max: 5, element: 'fire' }] }, makeCombatant(), makeCombatant(), () => 0);
    expect(calls[0]!.element).toBe('fire');
  });

  it('対象が倒れていれば撃たない', () => {
    const { calls } = runMagicSpy({ id: 'x', effects: [{ kind: 'fixedDamage', min: 5, max: 5 }] }, makeCombatant(), makeCombatant({ hp: 0 }), () => 0);
    expect(calls).toHaveLength(0);
  });

  it('luckScale: +attacker.luk × luckScale を加算 (luk 型魔法)', () => {
    const atk = makeCombatant({ luk: 30 });
    const { calls } = runMagicSpy({ id: 'x', effects: [{ kind: 'fixedDamage', min: 10, max: 10, luckScale: 0.2 }] }, atk, makeCombatant(), () => 0);
    expect(calls[0]!.amount).toBe(10 + 30 * 0.2); // 16
  });

  it('scaleBy buffCount: 自己バフ数で威力が伸びる (感情爆発)', () => {
    const bare = makeCombatant({ luk: 0, statuses: [] });
    const buffed = makeCombatant({
      luk: 0,
      statuses: [
        { id: 'atkUp', turns: 3 },
        { id: 'defUp', turns: 3 },
      ],
    });
    const def = { id: 'x', effects: [{ kind: 'fixedDamage' as const, min: 10, max: 10, scaleBy: 'buffCount' as const, scaleFactor: 0.5 }] };
    const bareAmt = runMagicSpy(def, bare, makeCombatant(), () => 0).calls[0]!.amount;
    const buffAmt = runMagicSpy(def, buffed, makeCombatant(), () => 0).calls[0]!.amount;
    expect(bareAmt).toBe(10); // バフ 0 → ×1
    expect(buffAmt).toBe(10 * (1 + 2 * 0.5)); // バフ 2 → ×2 = 20
  });
});

describe('runSkillMulti (マルチ対象解決 #453)', () => {
  const makeSides = (): CombatSides => ({
    allies: [makeCombatant({ name: 'P' })],
    enemies: [makeCombatant({ name: 'E1' }), makeCombatant({ name: 'E2' })],
  });

  /** runSkillMulti を spy で回し、doAttack が当たった defender 名 + status 付与対象を集める。 */
  function runMulti(def: SkillDef, attacker: Combatant, sides: CombatSides) {
    const hits: string[] = [];
    runSkillMulti(def, attacker, sides, (defender) => ({
      attacker,
      defender,
      rng: () => 0.5,
      events: [],
      skillName: 'x',
      engine: {
        doAttack: (_a, d) => {
          hits.push(d.name);
          return { hit: true, damage: 3, fatal: false, crit: false };
        },
        doMagic: (_a, d) => {
          hits.push(d.name);
          return { hit: true, damage: 3, fatal: false, crit: false };
        },
      },
    }));
    return hits;
  }

  it('effectTarget: damage=oneEnemy / heal=self / status(enemy)=oneEnemy / status(self)=self', () => {
    expect(effectTarget({ kind: 'damage', stat: 'atk' })).toBe('oneEnemy');
    expect(effectTarget({ kind: 'damage', stat: 'atk', target: 'allEnemies' })).toBe('allEnemies');
    expect(effectTarget({ kind: 'heal', ratio: 0.3 })).toBe('self');
    expect(effectTarget({ kind: 'status', status: 'poison', target: 'enemy' })).toBe('oneEnemy');
    expect(effectTarget({ kind: 'status', status: 'atkUp', target: 'self' })).toBe('self');
  });

  const noop = () => ({ hit: true, damage: 0, fatal: false as const, crit: false });
  const buffCtx = (attacker: Combatant) => (defender: Combatant): SkillContext => ({
    attacker,
    defender,
    rng: () => 0.5,
    events: [],
    skillName: 'x',
    engine: { doAttack: noop, doMagic: noop },
  });

  it('allEnemies 物理は敵全員に当たる', () => {
    const sides = makeSides();
    const hits = runMulti({ id: 'x', effects: [{ kind: 'damage', stat: 'atk', target: 'allEnemies' }] }, sides.allies[0]!, sides);
    expect(hits.sort()).toEqual(['E1', 'E2']);
  });

  it('oneEnemy は敵先頭のみ', () => {
    const sides = makeSides();
    const hits = runMulti({ id: 'x', effects: [{ kind: 'damage', stat: 'atk' }] }, sides.allies[0]!, sides);
    expect(hits).toEqual(['E1']);
  });

  it('self バフは敵人数に関係なく 1 回だけ使用者に付与', () => {
    const sides = makeSides();
    const p = sides.allies[0]!;
    runSkillMulti({ id: 'x', effects: [{ kind: 'status', status: 'atkUp', target: 'self' }] }, p, sides, buffCtx(p));
    expect(p.statuses?.filter((s) => s.id === 'atkUp')).toHaveLength(1); // 2 回付与されない
  });

  it('allEnemies デバフは敵全員に付与', () => {
    const sides = makeSides();
    const p = sides.allies[0]!;
    runSkillMulti({ id: 'x', effects: [{ kind: 'status', status: 'agiDown', target: 'allEnemies' }] }, p, sides, buffCtx(p));
    expect(sides.enemies.every((e) => e.statuses?.some((s) => s.id === 'agiDown'))).toBe(true);
  });
});
