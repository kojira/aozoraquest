/**
 * 装備を街で売る (委託販売。D-MARKET-001)。値段の目安・出せる品・手数料・上限を決めるのはここ 1 か所。
 * edge (出品・購入の権威) と web (「うる」の画面) が同じ関数を使う。
 *
 * - 値段は出品者が決める (1 以上の整数)。`marketPrice` は「うる」の画面に出す目安
 * - 売れたら 1 割を手数料として消し、出品者には `marketSellerTake` (9 割) が入る
 * - 期限は無い。売れるか取り下げるまで並ぶ
 */
import { maxShopGradeForTier, type EquipmentDef } from './equipment.js';
import { shopForbiddenDef } from './revive.js';
import { tierForRegion, type Town } from './world.js';

/** 強化値 (−1〜+10) ごとの目安の倍率。+5 までは制作の引き直し、+6 からは合成で 2 倍ずつ (D-MARKET-001 §1)。 */
export const MARKET_LEVEL_MULTIPLIER: Readonly<Record<number, number>> = {
  [-1]: 0.5, 0: 1, 1: 1.5, 2: 2, 3: 3, 4: 4, 5: 6, 6: 12, 7: 24, 8: 48, 9: 96, 10: 192,
};

/** 上限 (オーナー決定 2026-07-27 / 2026-11-18、1 人の合計は 2026-11-18 に 10 → 20)。1 人が出品中の数・1 つの街での数・1 つの街の棚の数。 */
export const MARKET_LIMITS = { perUser: 20, perUserPerTown: 2, perTown: 200 } as const;

/** 売れたときに消える手数料 (10 分の 1)。 */
export const MARKET_FEE_TENTHS = 1;

/** 値段の目安: `max(1, round(制作パワー × 倍率[強化値]))`。表に無い強化値は 0 (出せない品)。 */
export function marketPrice(def: EquipmentDef, level: number): number {
  const mult = MARKET_LEVEL_MULTIPLIER[level];
  if (mult === undefined) return 0;
  return Math.max(1, Math.round(def.price.power * mult));
}

/** 出品者の手取り (手数料 1 割を消したあと)。 */
export function marketSellerTake(price: number): number {
  return Math.floor((price * (10 - MARKET_FEE_TENTHS)) / 10); // 整数で計算 (小数の誤差で 1 ずれない)
}

/** 出品者が付けた値段として通るか (1 以上の整数)。 */
export function isValidMarketPrice(price: unknown): price is number {
  return typeof price === 'number' && Number.isSafeInteger(price) && price >= 1;
}

/** 出せない理由。装備中かどうかは持ち主の state が要るので edge (`overWorn`) で見る。 */
export type UnlistableReason = 'casino' | 'precious' | 'no_price' | 'bad_level' | 'grade_over_town';

/** その品をその街に出せるか。出せなければ理由を返す (画面で薄い字で出す)。 */
export function listable(def: EquipmentDef, level: number, town: Town): { ok: true } | { ok: false; reason: UnlistableReason } {
  if (def.casinoOnly) return { ok: false, reason: 'casino' };
  if (shopForbiddenDef(def)) return { ok: false, reason: 'precious' }; // 貴重な装備 (D-RARE-GEAR-001)
  if (def.price.power <= 0) return { ok: false, reason: 'no_price' };
  if (MARKET_LEVEL_MULTIPLIER[level] === undefined) return { ok: false, reason: 'bad_level' };
  if (def.grade > maxShopGradeForTier(tierForRegion(town.region))) return { ok: false, reason: 'grade_over_town' };
  return { ok: true };
}
