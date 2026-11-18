/** D-MARKET-001 PR4 (RED: 中身はまだ無い)。 */
import type { Archetype, Town } from '@aozoraquest/core';
import type { CraftedPiece } from '@/lib/crafting';
import type { MarketMyListing, MarketShelfItem } from '@/lib/market-server';
export type ShopTab = 'shop' | 'used' | 'sell';
export function ShopTabs(_p: { tab: ShopTab; onTab: (t: ShopTab) => void }) { return null; }
export function SellerHandle(_p: { did: string }) { return null; }
export function UsedShelf(_p: { shelf: MarketShelfItem[] | null; me: string | null; archetype: Archetype | null; balance: number; busy: boolean; onBuy: (item: MarketShelfItem) => void }) { return null; }
export function SellPanel(_p: { town: Town; pieces: CraftedPiece[]; equippedRkeys: readonly string[]; wornKeys: ReadonlyMap<string, number>; listings: MarketMyListing[]; busy: boolean; onList: (piece: CraftedPiece, price: number) => void; onCancel: (listing: MarketMyListing) => void }) { return null; }
