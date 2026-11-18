import { afterEach, describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  BATTLE_TUNING,
  EQUIPMENT,
  GEAR_LADDER,
  GEAR_GRADES,
  MAX_POPULATED_TIER,
  TIER_LEVEL,
  bonusWithLevel,
  gearGradeGaps,
  maxShopGradeForTier,
  playerCombatant,
  setItemOverrides,
  setMonsterOverrides,
  shopMaterialBand,
  tierForRegion,
  worldOverlay,
  type EquipmentDef,
  type MonsterDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

/** D-ENDGAME-001 PR1: 装備 6 段と、地図の帯の固定表 (案B)。 */

/** 本編の 8 つの街 (d-gear-002 §3・D-ENDGAME-001 §A4)。どれも tier1〜2 のまま。 */
const STORY_TOWNS: Record<string, number> = {
  ふたばの村: 1, ほむらの街: 1, こだまの杜: 1, おおたきの宿: 1,
  かすみの街: 2, いしだたみの宿場: 2, いただきの関: 2, けものみちの砦: 2,
};
/** 深い 8 リージョンの帯 (案B)。 */
const DEEP: Record<number, number> = { 45: 3, 51: 3, 55: 3, 60: 3, 52: 4, 54: 4, 61: 5, 53: 6 };

/** tier4〜6 にも 3 体ずつ置いた敵 (データを書いたあとの dev と同じ形)。 */
const withDeepMonsters = (): MonsterDef[] => {
  const extra: MonsterDef[] = [];
  for (const tier of [4, 5, 6] as const) {
    for (let i = 0; i < 3; i++) {
      extra.push({ id: `deep-${tier}-${i}`, name: `ふかい${tier}-${i}`, species: 'slime', tint: `#00${tier}${i}00`, level: TIER_LEVEL[tier], tier, stats: [40, 30, 20, 10, 10], hp: 30, xp: 60 + tier * 10, drops: [], intro: 'て。' });
    }
  }
  return [...TEST_MONSTERS, ...extra];
};

describe('地図の帯は固定の表 (案B)', () => {
  afterEach(() => setMonsterOverrides(TEST_MONSTERS));

  it('tier4〜6 の敵を足しても、本編の 8 街と tier1・2 のリージョンの帯は変わらない', () => {
    const before = Array.from({ length: 64 }, (_, r) => tierForRegion(r));
    setMonsterOverrides(withDeepMonsters());
    expect(MAX_POPULATED_TIER).toBe(6);
    const after = Array.from({ length: 64 }, (_, r) => tierForRegion(r));
    for (let r = 0; r < 64; r++) {
      if (before[r]! <= 2) expect(after[r], `region#${r}`).toBe(before[r]);
    }
    for (const town of worldOverlay().towns) {
      const want = STORY_TOWNS[town.name];
      if (want !== undefined) expect(tierForRegion(town.region), town.name).toBe(want);
    }
  });

  it('敵がそろうと、深い 8 リージョンが表の帯 (3〜6) になる', () => {
    setMonsterOverrides(withDeepMonsters());
    for (const [r, t] of Object.entries(DEEP)) expect(tierForRegion(Number(r)), `region#${r}`).toBe(t);
  });

  it('敵がそろっていない帯は、そろっている帯まで下げる (tier3 までしかいないと深い所も 3)', () => {
    expect(MAX_POPULATED_TIER).toBe(3);
    for (const r of Object.keys(DEEP)) expect(tierForRegion(Number(r)), `region#${r}`).toBe(3);
  });
});

describe('装備の grade は 1〜6', () => {
  afterEach(() => setItemOverrides(null));
  const piece = (grade: number): EquipmentDef => ({ id: `wp-g${grade}`, name: `g${grade}`, slot: 'weapon', kind: 'common', bonus: { atk: 1 }, grade: grade as never, price: { power: 1, materials: 0 } });

  it('grade 6 までの品をデータで持てる。7 と 0 は弾く', () => {
    expect(() => setItemOverrides({ items: [], equipment: GEAR_GRADES.map(piece) })).not.toThrow();
    expect(() => setItemOverrides({ items: [], equipment: [piece(7)] })).toThrow();
    expect(() => setItemOverrides({ items: [], equipment: [piece(0)] })).toThrow();
  });

  it('店の grade の上限は tier と同じで 6 まで。素材の帯も 6 帯', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(maxShopGradeForTier)).toEqual([1, 2, 3, 4, 5, 6, 6, 6]);
    expect([1, 2, 3, 4, 5, 6, 7].map(shopMaterialBand)).toEqual([0, 1, 2, 3, 4, 5, 5]);
  });

  it('16 職が各 grade で装備できる武器と胴を持つかを調べられる (欠けを返す)', () => {
    const full: EquipmentDef[] = GEAR_GRADES.flatMap((g) => [
      { ...piece(g), id: `w${g}` },
      { id: `a${g}`, name: `a${g}`, slot: 'armor', kind: 'cloth', bonus: { def: 1 }, grade: g, price: { power: 1, materials: 0 } },
    ]);
    expect(gearGradeGaps(full)).toEqual([]);
    const noArmor6 = full.filter((e) => e.id !== 'a6');
    const gaps = gearGradeGaps(noArmor6);
    expect(gaps).toHaveLength(ARCHETYPES.length);
    expect(gaps.every((g) => g.grade === 6 && g.slot === 'armor')).toBe(true);
    // 同梱の品 (grade1〜3 だけ) には grade4〜6 が無い
    expect(gearGradeGaps(EQUIPMENT, [4]).length).toBe(ARCHETYPES.length * 2);
  });
});

describe('梯子の値: 守りを上げると必ず効く (床の上)', () => {
  const t = BATTLE_TUNING;
  const raw = (atk: number, def: number) => atk * t.atkCoef - def * t.defCoef;

  it('1 つ下の装備で受けるダメージは床より上で、その帯の装備にすると減る (tier2〜6・16 職)', () => {
    for (const g of [2, 3, 4, 5, 6] as const) {
      const step = GEAR_LADDER[g];
      const below = GEAR_LADDER[(g - 1) as 1];
      expect(step.level).toBe(TIER_LEVEL[g]);
      for (const job of ARCHETYPES) {
        const base = playerCombatant(job, step.level, 1, 'h').def;
        const lower = raw(step.enemy.atk, base + below.armorTotal);
        const own = raw(step.enemy.atk, base + step.armorTotal);
        expect(lower, `g${g} ${job}: 1 つ下の装備で床に張りつく`).toBeGreaterThan(step.enemy.atk * t.scratchRatio);
        expect(Math.max(own, step.enemy.atk * t.scratchRatio), `g${g} ${job}`).toBeLessThan(lower * 0.75);
      }
    }
  });

  it('武器を 1 段上げると、帯の敵を倒す回数がはっきり減る', () => {
    for (const g of [2, 3, 4, 5, 6] as const) {
      const step = GEAR_LADDER[g];
      const below = GEAR_LADDER[(g - 1) as 1];
      const atk = playerCombatant('warrior', step.level, 1, 'h').atk;
      const hits = (w: number) => step.enemy.hp / Math.max((atk + w) * t.scratchRatio, raw(atk + w, step.enemy.def));
      expect(hits(below.weaponAtk), `g${g}`).toBeGreaterThan(hits(step.weaponAtk) * 1.4);
    }
  });
});

describe('強化値は 1 段で主効果の 1 割 (D-ENDGAME-001 §A3)', () => {
  const sword: EquipmentDef = { id: 'w', name: 'つるぎ', slot: 'weapon', kind: 'common', bonus: { atk: 108, luk: 3 }, grade: 6, price: { power: 1, materials: 0 } };
  const knife: EquipmentDef = { id: 'k', name: 'ナイフ', slot: 'weapon', kind: 'common', bonus: { atk: 4 }, grade: 1, price: { power: 1, materials: 0 } };

  it('+10 で 2 倍、+5 で 1.5 倍。副効果は変わらない', () => {
    expect(bonusWithLevel(sword, 10).atk).toBe(216);
    expect(bonusWithLevel(sword, 5).atk).toBe(162);
    expect(bonusWithLevel(sword, 5).luk).toBe(3);
    expect(bonusWithLevel(sword, -1).atk).toBe(97);
  });

  it('小さい値でも 1 段は最低 +1 (−1 は最低 −1)、主効果は 1 未満にならない', () => {
    expect(bonusWithLevel(knife, 1).atk).toBe(5);
    expect(bonusWithLevel(knife, 10).atk).toBe(8);
    expect(bonusWithLevel(knife, -1).atk).toBe(3);
    expect(bonusWithLevel({ ...knife, bonus: { atk: 1 } }, -1).atk).toBe(1);
  });
});
