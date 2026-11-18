/** D-MARKET-001 PR2 (RED: 中身はまだ無い)。 */
import type { GameState, GameStateEnv, MarketListing, OwnedPiece } from './game-state';
import type { ShelfListing, TownStock } from './market-stock';
type Init = (did: string, nowIso: string) => Promise<GameState>;
type Pos = { x: number; y: number; mapId?: string };
export interface MarketMineResult { pieces: OwnedPiece[]; listings: MarketListing[]; returned: MarketListing[] }
export interface MarketListResult extends MarketMineResult { listing?: MarketListing; duplicate: boolean; onShelf: boolean }
export async function listOnShelf(_e: GameStateEnv, _s: string, _l: MarketListing, _n: number): Promise<boolean> { return true; }
export async function marketList(_e: GameStateEnv, _d: string, _i: { pieceRkey: string; price: unknown; rkey: string; pos?: Pos }, _n: number, _init?: Init): Promise<MarketListResult> { return { pieces: [], listings: [], returned: [], duplicate: false, onShelf: false }; }
export async function marketCancel(_e: GameStateEnv, _d: string, _i: { listingId: string }, _n: number, _init?: Init): Promise<MarketMineResult> { return { pieces: [], listings: [], returned: [] }; }
export async function marketReconcile(_e: GameStateEnv, _d: string, _n: number, _init?: Init): Promise<MarketMineResult> { return { pieces: [], listings: [], returned: [] }; }
export function shelfCheapestFirst(stock: TownStock | null): ShelfListing[] { return stock?.listings ?? []; }
