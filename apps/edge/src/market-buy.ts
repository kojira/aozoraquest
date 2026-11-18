/** D-MARKET-001 PR3 (RED: 中身はまだ無い)。 */
import type { GameState, GameStateEnv, MarketHold, OwnedPiece } from './game-state';
type Init = (did: string, nowIso: string) => Promise<GameState>;
type Pos = { x: number; y: number; mapId?: string };
export const MAX_MARKET_HOLDS = 3;
export interface MarketBuyResult { bought: boolean; duplicate: boolean; pending: boolean; power: number; pieces: OwnedPiece[] }
export async function sellOnShelf(_e: GameStateEnv, _b: string, _h: MarketHold, _n: number): Promise<boolean> { return true; }
export async function marketBuy(_e: GameStateEnv, _d: string, _i: { seller: unknown; listingId: unknown; rkey: unknown; pos?: Pos }, _n: number, _init?: Init): Promise<MarketBuyResult> { return { bought: true, duplicate: false, pending: false, power: 0, pieces: [] }; }
export async function settleOldHolds(_e: GameStateEnv, _d: string, _n: number, _init?: Init): Promise<GameState | null> { return null; }
