import { describe, it, expect, afterEach } from 'vitest';
import {
  setMonsterOverrides,
  hasMonsterOverrides,
  monsterCountByTier,
  MonsterDataError,
  MONSTERS,
  MONSTERS_BY_ID,
  MAX_POPULATED_TIER,
  battleXpFor,
  startBattle,
  runAutoBattle,
  type MonsterDef,
} from '../index.js';
import * as core from '../index.js';

/**
 * **モンスターをレコードで差し替える** (#419 / #537)。
 *
 * ここで固定するのは 3 つ:
 *  - 差し替えると MONSTERS / MONSTERS_BY_ID / MAX_POPULATED_TIER / 戦闘 の**全部**に効く
 *    (参照を保ったまま中身を入れ替えるので、既存の import 先も新しい敵を見る)
 *  - 解除でコード直書きへ**完全に戻る** (戻らないと他のテストを汚染する)
 *  - **壊れた 1 体で全体を落とす** (部分適用しない)
 */
const base = (over: Partial<MonsterDef> = {}): MonsterDef => ({
  id: 'test-slime',
  name: 'てすとスライム',
  species: 'slime',
  level: 1,
  tier: 1,
  stats: [7, 5, 6, 2, 4],
  hp: 5,
  drops: [],
  intro: 'てすと。',
  ...over,
});

const trio = (tier: 1 | 2 | 3 | 4, prefix: string): MonsterDef[] =>
  [0, 1, 2].map((i) => base({ id: `${prefix}-${i}`, name: `${prefix}${i}`, tier }));

describe('モンスターのレコード差し替え (#419)', () => {
  afterEach(() => setMonsterOverrides(null));

  it('差し替えると一覧・辞書・戦闘の全部に効き、解除で完全に戻る', () => {
    const originalCount = MONSTERS.length;
    const originalIds = MONSTERS.map((m) => m.id);

    setMonsterOverrides([...trio(1, 'a'), base({ id: 'boss', name: 'ぼす', tier: 1, hp: 9, xp: 42 })]);
    expect(hasMonsterOverrides()).toBe(true);
    expect(MONSTERS).toHaveLength(4);
    expect(MONSTERS_BY_ID['boss']?.name).toBe('ぼす');
    expect(MONSTERS_BY_ID[originalIds[0]!]).toBeUndefined();
    expect(battleXpFor('boss')).toBe(42);
    // 戦闘も新しい敵で回る
    const r = runAutoBattle(startBattle('warrior', 5, 1, 'x', 1, 7, 0, undefined, { monsterId: 'boss' }));
    expect(['win', 'lose', 'draw', 'fled', 'monster-fled']).toContain(r.outcome);

    setMonsterOverrides(null);
    expect(hasMonsterOverrides()).toBe(false);
    expect(MONSTERS).toHaveLength(originalCount);
    expect(MONSTERS.map((m) => m.id)).toEqual(originalIds);
  });

  it('MAX_POPULATED_TIER が追従する (敵を足せば上の帯が解放される)', () => {
    // live binding なので import 側から再読して確かめる
    const before = core.MAX_POPULATED_TIER;
    expect(before).toBe(3); // 現状 tier4 以上は 3 体未満
    setMonsterOverrides([...trio(1, 'a'), ...trio(2, 'b'), ...trio(3, 'c'), ...trio(4, 'd')]);
    expect(core.MAX_POPULATED_TIER).toBe(4);
    setMonsterOverrides(null);
    expect(core.MAX_POPULATED_TIER).toBe(before);
    void MAX_POPULATED_TIER; // 直接 import した束縛はモジュールの再読で更新される (ESM)
  });

  it('壊れた 1 体で全体を落とす (部分適用しない)', () => {
    const beforeCount = MONSTERS.length;
    const bad = [...trio(1, 'a'), base({ id: 'a-0' })]; // id 重複
    expect(() => setMonsterOverrides(bad)).toThrow(MonsterDataError);
    expect(MONSTERS).toHaveLength(beforeCount); // 何も変わっていない
    expect(hasMonsterOverrides()).toBe(false);

    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', hp: 0 })])).toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', stats: [1, 2, 3] as never })])).toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', ability: 'caster' })])).toThrow(MonsterDataError); // spell なし
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', drops: [{ item: 'slime-drop', chance: 2 }] })])).toThrow(MonsterDataError);
  });

  it('**tier1 が 3 体を下回る差し替えは拒否** (遭遇が壊れて街から出られなくなる)', () => {
    expect(() => setMonsterOverrides([base({ id: 'only' })])).toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([base({ id: 'a' }), base({ id: 'b' })])).toThrow(MonsterDataError);
    // ちょうど 3 体なら通る
    expect(() => setMonsterOverrides(trio(1, 'ok'))).not.toThrow();
  });

  it('tier ごとの頭数を数えられる (エディタの検証表示用)', () => {
    setMonsterOverrides([...trio(1, 'a'), ...trio(2, 'b')]);
    expect(monsterCountByTier()).toEqual({ 1: 3, 2: 3 });
  });
});

describe('空プールで移動を殺さない (#419)', () => {
  afterEach(() => setMonsterOverrides(null));

  it('プールが空の tier は**下の帯に繰り下げて**遭遇を成立させる (落とさない)', () => {
    // 落とすと edge の handleMove が 500 になり、プレイヤーはその場から一歩も動けなくなる。
    // 「データが壊れていたら移動不能」という壊れ方は許されない。
    const r = core.summonMonster(7 as never, 1, 123); // tier7 は 0 体
    expect(r.def).toBeDefined();
    expect(r.def.tier).toBeLessThanOrEqual(6); // 近い下の帯から出る
    expect(r.combatant.hp).toBeGreaterThan(0);
  });

  it('差し替えで中間の帯が空いても同様 (tier2 を 0 体にする)', () => {
    setMonsterOverrides([...trio(1, 'a'), ...trio(3, 'c')]);
    const r = core.summonMonster(2 as never, 1, 456);
    expect(r.def.tier).toBe(1); // tier2 が空 → tier1 に繰り下げ
  });
});

describe('healer の回復幅とspell の検証 (#419)', () => {
  afterEach(() => setMonsterOverrides(null));

  it('healRatio が敵ごとに効く', () => {
    setMonsterOverrides([
      ...trio(1, 'a'),
      base({ id: 'tough', name: 'しぶとい', hp: 40, mp: 30, ability: 'healer', healRatio: 0.5, stats: [1, 5, 1, 20, 4] }),
    ]);
    // 直接 heal 行動を検証するのは resolveTurn 経由になるので、値の伝播だけ固定する
    expect(MONSTERS_BY_ID['tough']?.healRatio).toBe(0.5);
  });

  it('壊れた healRatio / spell は保存できない', () => {
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', ability: 'healer', healRatio: 1.5 })]))
      .toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', ability: 'caster', spell: { name: 'x', min: 9, max: 3 } })]))
      .toThrow(MonsterDataError); // min > max
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', ability: 'caster', spell: { name: '', min: 'a' } as never })]))
      .toThrow(MonsterDataError);
  });
});

describe('能力パラメータの上書き (#592 段階 1)', () => {
  afterEach(() => setMonsterOverrides(null));

  it('ため確率が敵ごとに効く (実測: 0 なら一度もためない / 1 なら MP がある限りためる)', () => {
    const mk = (chargeChance: number) => [
      ...trio(1, 'a'),
      base({ id: 'ch', name: 'ためんぼ', hp: 60, mp: 50, ability: 'charger', skillName: 'ためどん',
             stats: [10, 5, 1, 20, 4], abilityParams: { chargeChance } }),
    ];
    const chargeCount = (chance: number) => {
      setMonsterOverrides(mk(chance));
      let n = 0;
      for (let seed = 0; seed < 20; seed++) {
        let s = core.startBattle('guardian', 20, 1, 'x', 1, seed, 0, undefined, { monsterId: 'ch' });
        for (let i = 0; i < 8 && s.outcome === 'ongoing'; i++) {
          s = core.resolveTurn(s, 'guard', seed * 131 + i);
          if (s.lastEvents.some((e) => e.text.includes('ためている'))) n++;
        }
      }
      return n;
    };
    expect(chargeCount(0), 'ため確率 0 なのにためた').toBe(0);
    expect(chargeCount(1), 'ため確率 1 なのにためない').toBeGreaterThan(20);
  });

  it('壊れたパラメータは保存できない (0〜1 の範囲外)', () => {
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', abilityParams: { chargeChance: 1.5 } })]))
      .toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', abilityParams: { fleeBase: -0.1 } })]))
      .toThrow(MonsterDataError);
  });
});

describe('複数の能力 (#592 段階 2)', () => {
  afterEach(() => setMonsterOverrides(null));

  it('優先順は配列の順 (healer が動かないときだけ charger が動く)', () => {
    // HP 満タン (healer の閾値に届かない) → charger のため が出る。
    // HP を削る → healer の回復が優先される。
    setMonsterOverrides([
      ...trio(1, 'a'),
      base({
        id: 'combo', name: 'こんぼ', hp: 60, mp: 60, stats: [10, 5, 1, 20, 4],
        abilities: ['healer', 'charger'], skillName: 'ためどん',
        abilityParams: { healChance: 1, lowHpRatio: 0.6, chargeChance: 1 },
      }),
    ]);
    // HP 満タンから: healer は発動条件 (低 HP) を満たさず attack を返し、charger に回る。
    // **攻め手は弱い職の低レベル** — 強い職だと healer の閾値に届く前に敵が死ぬ
    // (guardian Lv20 で実測 2 ターン即死し、回復が一度も観測できなかった)。
    let charged = 0, healed = 0;
    for (let seed = 0; seed < 15; seed++) {
      let s = core.startBattle('warrior', 1, 1, 'x', 1, seed, 0, undefined, { monsterId: 'combo' });
      for (let i = 0; i < 10 && s.outcome === 'ongoing'; i++) {
        s = core.resolveTurn(s, 'attack', seed * 131 + i);
        if (s.lastEvents.some((e) => e.text.includes('ためている'))) charged++;
        if (s.lastEvents.some((e) => e.text.includes('回復'))) healed++;
      }
    }
    expect(charged, '満タン時に charger が動いていない').toBeGreaterThan(0);
    expect(healed, '削られたら healer が優先されるはず').toBeGreaterThan(0);
  });

  it('単数 ability は後方互換で動く', () => {
    setMonsterOverrides([
      ...trio(1, 'a'),
      base({ id: 'old', name: 'ふるい', hp: 40, mp: 40, ability: 'charger', skillName: 'x',
             stats: [10, 5, 1, 20, 4], abilityParams: { chargeChance: 1 } }),
    ]);
    let charged = 0;
    for (let seed = 0; seed < 10; seed++) {
      let s = core.startBattle('guardian', 20, 1, 'x', 1, seed, 0, undefined, { monsterId: 'old' });
      for (let i = 0; i < 4 && s.outcome === 'ongoing'; i++) {
        s = core.resolveTurn(s, 'guard', seed * 131 + i);
        if (s.lastEvents.some((e) => e.text.includes('ためている'))) charged++;
      }
    }
    expect(charged).toBeGreaterThan(0);
  });

  it('壊れた abilities は保存できない', () => {
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', abilities: [] })])).toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', abilities: ['charger', 'charger'] })])).toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', abilities: ['zzz' as never] })])).toThrow(MonsterDataError);
    // abilities 側に caster があるのに spell が無い
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', abilities: ['caster'] })])).toThrow(MonsterDataError);
  });
});
