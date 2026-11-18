/** D-MARKET-001 §1: 値段の目安・出せる品・手数料・上限 (market.ts)。 */
import { describe, expect, it } from 'vitest';
import { EQUIPMENT, EQUIPMENT_BY_ID, maxShopGradeForTier, type EquipmentDef } from '../equipment.js';
import { isValidMarketPrice, listable, MARKET_LIMITS, marketPrice, marketSellerTake } from '../market.js';
import { tierForRegion, worldOverlay } from '../world.js';

const towns = worldOverlay().towns;
const tier3Town = towns.find((t) => maxShopGradeForTier(tierForRegion(t.region)) >= 3)!;
const tier1Town = towns.find((t) => maxShopGradeForTier(tierForRegion(t.region)) === 1)!;

describe('marketPrice (値段の目安)', () => {
  it('12 段階の倍率: 制作パワー 10 の品で −1〜+10', () => {
    const def = EQUIPMENT_BY_ID['wp-axe']!; // price.power 10
    expect(def.price.power).toBe(10);
    const got = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((lv) => marketPrice(def, lv));
    expect(got).toEqual([5, 10, 15, 20, 30, 40, 60, 120, 240, 480, 960, 1920]);
  });

  it('最低値は 1 (制作パワー 1 の −1 でも 0 にならない)', () => {
    const cheap: EquipmentDef = { ...EQUIPMENT_BY_ID['wp-knife']!, price: { power: 1, materials: 0 } };
    expect(marketPrice(cheap, -1)).toBe(1);
    expect(marketPrice(EQUIPMENT_BY_ID['ar-cloth']!, -1)).toBe(2); // 今の品の最低 (ぬののふく−1)
  });

  it('ジョブ専用の上位品 +10 = 40 × 192 = 7,680 (今の品の最高)', () => {
    const high = EQUIPMENT.find((e) => e.jobOnly && e.grade === 3)!;
    expect(marketPrice(high, 10)).toBe(7680);
    expect(Math.max(...EQUIPMENT.filter((e) => !e.casinoOnly).map((e) => marketPrice(e, 10)))).toBe(7680);
  });
});

describe('listable (出せる品)', () => {
  it('casinoOnly・price 0・段階超え・表に無い強化値を断り、理由を返す', () => {
    const star = EQUIPMENT_BY_ID['wp-star-sword']!;
    expect(listable(star, 0, tier3Town)).toEqual({ ok: false, reason: 'casino' });
    const free: EquipmentDef = { ...EQUIPMENT_BY_ID['wp-knife']!, price: { power: 0, materials: 0 } };
    expect(listable(free, 0, tier3Town)).toEqual({ ok: false, reason: 'no_price' });
    const grade2 = EQUIPMENT_BY_ID['ar-iron']!;
    expect(grade2.grade).toBe(2);
    expect(listable(grade2, 0, tier1Town)).toEqual({ ok: false, reason: 'grade_over_town' });
    expect(listable(grade2, 11, tier3Town)).toEqual({ ok: false, reason: 'bad_level' });
  });

  it('ふつうの品は出せる (段階の中の街なら)', () => {
    expect(listable(EQUIPMENT_BY_ID['wp-knife']!, 3, tier1Town)).toEqual({ ok: true });
    expect(listable(EQUIPMENT_BY_ID['ar-iron']!, 10, tier3Town)).toEqual({ ok: true });
  });
});

describe('手数料と上限', () => {
  it('出品者の手取りは floor(値段 × 0.9)。1 割が消える', () => {
    expect(marketSellerTake(100)).toBe(90);
    expect(marketSellerTake(15)).toBe(13);
    expect(marketSellerTake(1)).toBe(0);
  });

  it('値段は 1 以上の整数だけ通す', () => {
    expect(isValidMarketPrice(1)).toBe(true);
    expect(isValidMarketPrice(7680)).toBe(true);
    for (const bad of [0, -1, 1.5, Number.NaN, '10', null]) expect(isValidMarketPrice(bad)).toBe(false);
  });

  it('上限: 1 人 20 品・1 つの街に 2 品・街の棚 200 品', () => {
    expect(MARKET_LIMITS).toEqual({ perUser: 20, perUserPerTown: 2, perTown: 200 });
  });
});
