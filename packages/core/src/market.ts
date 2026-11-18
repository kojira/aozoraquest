/** D-MARKET-001 (RED: 中身はまだ無い)。 */
import type { EquipmentDef } from './equipment.js';
import type { Town } from './world.js';
export const MARKET_LEVEL_MULTIPLIER: Readonly<Record<number, number>> = {};
export const MARKET_LIMITS = { perUser: 0, perUserPerTown: 0, perTown: 0 } as const;
export const MARKET_FEE_RATE = 0;
export function marketPrice(_def: EquipmentDef, _level: number): number { return 0; }
export function marketSellerTake(_price: number): number { return 0; }
export function isValidMarketPrice(_price: unknown): _price is number { return false; }
export type UnlistableReason = 'casino' | 'no_price' | 'bad_level' | 'grade_over_town';
export function listable(_def: EquipmentDef, _level: number, _town: Town): { ok: true } | { ok: false; reason: UnlistableReason } { return { ok: true }; }
