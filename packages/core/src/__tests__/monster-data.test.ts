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

describe('どうぐ・装備のレコード差し替え (#420)', () => {
  afterEach(() => core.setItemOverrides(null));

  it('差し替えると ITEMS / EQUIPMENT / 店の品揃え / 装備可否に効き、解除で戻る', () => {
    const eqCount = core.EQUIPMENT.length;
    const items = [{ id: 'herb', name: 'すごいやくそう' }];
    const equipment = [
      { id: 'wp-test', name: 'てすとの剣', slot: 'weapon', kind: 'common', bonus: { atk: 3 }, grade: 1, price: { power: 4, materials: 1 } },
      { id: 'ar-test', name: 'てすとの服', slot: 'armor', kind: 'cloth', bonus: { def: 2 }, grade: 1, price: { power: 4, materials: 1 } },
    ] as const;
    core.setItemOverrides({ items, equipment: equipment as never });
    expect(core.ITEMS['herb']?.name).toBe('すごいやくそう');
    expect(core.EQUIPMENT).toHaveLength(2);
    expect(core.EQUIPMENT_BY_ID['wp-test']?.name).toBe('てすとの剣');
    // 装備可否・ボーナスにも効く (canEquip / gearBonus は EQUIPMENT_BY_ID を引く)
    expect(core.canEquip('warrior', core.EQUIPMENT_BY_ID['wp-test']!)).toBe(true);
    expect(core.gearBonus('warrior', ['wp-test']).atk).toBe(3);

    core.setItemOverrides(null);
    expect(core.EQUIPMENT).toHaveLength(eqCount);
    expect(core.ITEMS['herb']?.name).toBe('やくそう');
  });

  it('壊れた 1 件で全体を落とす', () => {
    const ok = { id: 'wp-a', name: 'a', slot: 'weapon', kind: 'common', bonus: {}, grade: 1, price: { power: 1, materials: 0 } } as const;
    expect(() => core.setItemOverrides({ items: [], equipment: [] })).toThrow(core.ItemDataError); // 0 品
    expect(() => core.setItemOverrides({ items: [], equipment: [ok, { ...ok }] as never })).toThrow(core.ItemDataError); // id 重複
    expect(() => core.setItemOverrides({ items: [], equipment: [{ ...ok, grade: 5 }] as never })).toThrow(core.ItemDataError);
    expect(() => core.setItemOverrides({ items: [], equipment: [{ ...ok, bonus: { zzz: 1 } }] as never })).toThrow(core.ItemDataError);
    // **exclusive なのに jobOnly なし = 誰も装備できない品** は保存で弾く
    expect(() => core.setItemOverrides({ items: [], equipment: [{ ...ok, kind: 'exclusive' }] as never })).toThrow(core.ItemDataError);
    expect(() => core.setItemOverrides({ items: [{ id: '', name: 'x' }], equipment: [ok] as never })).toThrow(core.ItemDataError);
  });
});

describe('店のラインナップ上書き (#422)', () => {
  afterEach(() => core.setShopOverrides(null));

  it('上書きした店だけ変わり、他は生成のまま。解除で戻る', () => {
    const towns = core.worldOverlay().towns;
    const a = towns[0]!;
    const b = towns[1]!;
    const beforeA = core.townShopStock(a, 0);
    const beforeB = core.townShopStock(b, 1);

    core.setShopOverrides([{ x: a.x, y: a.y, equipment: ['wp-knife'], materialId: 'slime-drop' }]);
    const afterA = core.townShopStock(a, 0);
    expect(afterA.equipment).toEqual(['wp-knife']);
    expect(afterA.materialId).toBe('slime-drop');
    expect(afterA.consumables).toEqual(beforeA.consumables); // 指定しないフィールドは生成のまま
    expect(core.townShopStock(b, 1)).toEqual(beforeB); // 他の店は不変

    core.setShopOverrides(null);
    expect(core.townShopStock(a, 0)).toEqual(beforeA);
  });

  it('**未知の id は保存で弾く** (「並んでいるのに買えない店」を静かに作らない)', () => {
    const t = core.worldOverlay().towns[0]!;
    expect(() => core.setShopOverrides([{ x: t.x, y: t.y, equipment: ['zzz-nope'] }])).toThrow(core.ShopDataError);
    expect(() => core.setShopOverrides([{ x: t.x, y: t.y, materialId: 'zzz' }])).toThrow(core.ShopDataError);
    expect(() => core.setShopOverrides([{ x: t.x, y: t.y }, { x: t.x, y: t.y }])).toThrow(core.ShopDataError); // 重複
    // 全体が落ちている (部分適用していない)
    expect(core.shopOverrides()).toEqual([]);
  });

  it('サーバー権威と同じ経路で効く (shopCraft が見る stock が変わる)', () => {
    // shopAt → townShopStock なので、上書きすれば「買える品」自体が変わる。
    // ここでは core レベルで stock の一致だけ固定する (edge の結合は shop.test が担う)。
    const t = core.worldOverlay().towns[0]!;
    core.setShopOverrides([{ x: t.x, y: t.y, equipment: ['ar-cloth'] }]);
    expect(core.townShopStock(t, 0).equipment).toEqual(['ar-cloth']);
  });
});

describe('店主のセリフ (#385 / #422)', () => {
  afterEach(() => core.setShopOverrides(null));

  it('既定は街ごとに決定的 (いつ来ても同じ人がいる)', () => {
    const a = core.shopKeeperFor(64, 64);
    expect(a.greeting).toBeTruthy();
    expect(core.shopKeeperFor(64, 64)).toEqual(a); // 決定的
    // 別の街とは (概ね) 口調が違いうる — 少なくとも API として独立している
    expect(core.shopKeeperFor(192, 64).greeting).toBeTruthy();
  });

  it('上書きが部分的に効く (指定したセリフだけ変わる)', () => {
    const before = core.shopKeeperFor(64, 64);
    core.setShopOverrides([{ x: 64, y: 64, keeper: { greeting: 'ようこそ、そらみの街へ！', name: 'ドグ' } }]);
    const after = core.shopKeeperFor(64, 64);
    expect(after.greeting).toBe('ようこそ、そらみの街へ！');
    expect(after.name).toBe('ドグ');
    expect(after.craft).toBe(before.craft); // 指定しないものは既定のまま
  });

  it('長すぎるセリフは保存で弾く (DQ の窓に収まらない)', () => {
    expect(() => core.setShopOverrides([{ x: 1, y: 1, keeper: { greeting: 'あ'.repeat(61) } }]))
      .toThrow(core.ShopDataError);
  });
});

describe('NPC (#425)', () => {
  afterEach(() => core.setNpcs(null));

  it('置くとそのマスが塞がり (ぶつかる = 話す)、解除で歩けるようになる', () => {
    // 歩けるマスを探す
    let X = 0, Y = 0;
    outer: for (let y = 300; y < 340; y++) for (let x = 200; x < 240; x++) {
      if (core.isWalkableAt(x, y)) { X = x; Y = y; break outer; }
    }
    expect(core.isWalkableAt(X, Y)).toBe(true);
    core.setNpcs([{ id: 'v1', name: 'むらびと', x: X, y: Y, lines: ['こんにちは。'] }]);
    expect(core.npcAt(X, Y)?.name).toBe('むらびと');
    expect(core.isWalkableAt(X, Y), 'NPC のマスは塞がるはず').toBe(false);
    core.setNpcs(null);
    expect(core.isWalkableAt(X, Y)).toBe(true);
  });

  it('壊れた 1 人で全体を落とす', () => {
    const ok = { id: 'a', name: 'あ', x: 1, y: 1, lines: ['や'] };
    expect(() => core.setNpcs([ok, { ...ok, id: 'a' }])).toThrow(core.NpcDataError); // id 重複
    expect(() => core.setNpcs([ok, { ...ok, id: 'b' }])).toThrow(core.NpcDataError); // 同じマス
    expect(() => core.setNpcs([{ ...ok, lines: [] }])).toThrow(core.NpcDataError); // セリフなし
    expect(() => core.setNpcs([{ ...ok, lines: ['あ'.repeat(121)] }])).toThrow(core.NpcDataError);
    expect(() => core.setNpcs([{ ...ok, x: 1.5 }])).toThrow(core.NpcDataError);
    expect(core.allNpcs()).toEqual([]); // 部分適用していない
  });

  it('座標はトーラスで引ける', () => {
    core.setNpcs([{ id: 'w', name: 'はし', x: 1024 + 3, y: -2, lines: ['まるまる。'] }]);
    expect(core.npcAt(3, 1022)?.id).toBe('w');
  });
});
