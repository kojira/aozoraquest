/**
 * 装備を街で売る (委託販売。D-MARKET-001 §1・§2)。出品・取り下げ・照合。
 *
 * 購入と売上の受け取りの流れは market-buy.ts。
 *
 * 出品は 2 回書く。1) 出品者の GameState: pieces → listings。2) 街の棚 townStock: 棚に足す。
 * 途中で止まっても、次に出品者が店を開いたときの照合 (`marketReconcile`) で続きから直す。
 * - 棚に足すのは listedAt から LISTING_WRITE_WINDOW_SEC (5 分) 以内だけ。照合は LISTING_SETTLE_SEC (10 分) を
 *   過ぎても棚に無い品を持ち物に戻す。5 分 < 10 分なので、戻したあとで棚に載ることはない
 * - 取り下げ・満杯で断った品は棚の closed に印を残す。印のある品は遅れて届いた書き込みでも棚に載らず、照合ですぐ戻る
 * - 期限は無い。売れるか取り下げるまで並ぶ
 */
import { EQUIPMENT_BY_ID, gearKey, isValidMarketPrice, listable, MARKET_LIMITS, marketSellerTake, overWorn } from '@aozoraquest/core';
import { readModifyWrite, readState, type GameState, type GameStateEnv, type MarketListing, type OwnedPiece } from './game-state';
import { wearersOf } from './party-gear';
import { alreadyDone, shopAt, ShopError, withOp } from './shop';
import { assertMarketRkey, LISTING_SETTLE_SEC, LISTING_WRITE_WINDOW_SEC, modifyTownStock, readTownStock, sameListing, townStockRkey, type ShelfListing, type ShelfSale, type TownStock } from './market-stock';

type Init = (did: string, nowIso: string) => Promise<GameState>;
type Pos = { x: number; y: number; mapId?: string };

/** 売れた知らせ (出品者が受け取ったとき)。 */
export interface MarketSoldNotice {
  listingId: string;
  itemId: string;
  level: number;
  price: number;
  /** 出品者に入ったパワー (手数料 1 割を消したあと)。 */
  take: number;
  buyer: string;
}

export interface MarketMineResult {
  pieces: OwnedPiece[];
  listings: MarketListing[];
  /** 照合で持ち物に戻した品。 */
  returned: MarketListing[];
  /** 照合で受け取った売上。 */
  sold: MarketSoldNotice[];
  power: number;
}
export interface MarketListResult extends MarketMineResult {
  /** 出品した品 (再送で、もう片づいていた品なら無い)。 */
  listing?: MarketListing;
  duplicate: boolean;
  /** 棚に並んだか (満杯などで断られたら false。品は持ち物に戻っている)。 */
  onShelf: boolean;
}

const sameTown = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x === b.x && a.y === b.y;

/** 出品の手順 1: 出品者の RMW。pieces から抜いて listings に入れる (同じ rkey は 1 回だけ)。 */
async function listOnSeller(env: GameStateEnv, did: string, input: { pieceRkey: string; price: number; rkey: string; pos?: Pos }, now: number, init?: Init): Promise<{ state: GameState; listing: MarketListing | undefined; duplicate: boolean }> {
  const opKey = `list:${input.rkey}`;
  let duplicate = false;
  const state = await readModifyWrite(env, did, (cur) => {
    if (alreadyDone(cur, opKey)) { duplicate = true; return cur; }
    duplicate = false;
    const { town } = shopAt(cur, input.pos); // 街の店でしか出せない
    const owned = cur.pieces ?? [];
    const piece = owned.find((p) => p.rkey === input.pieceRkey);
    if (!piece) throw new ShopError('その品を もっていない', 400, 'not_owned');
    const def = EQUIPMENT_BY_ID[piece.itemId];
    if (!def) throw new ShopError('その品は無い', 400, 'unknown_item');
    const ok = listable(def, piece.level, town);
    if (!ok.ok) throw new ShopError(ok.reason === 'grade_over_town' ? 'この街では あつかえない品だ' : 'その品は うれない', 400, ok.reason);
    const rest = owned.filter((p) => p.rkey !== piece.rkey);
    // 主人公・仲間が着ているぶんを残りで賄えないなら断る (forge・discard と同じ overWorn)。
    if (overWorn(wearersOf(cur), rest).includes(gearKey(piece.itemId, piece.level))) throw new ShopError('そうび中の品は うれない。さきに はずしてほしい', 400, 'equipped');
    const listings = cur.listings ?? [];
    if (listings.length >= MARKET_LIMITS.perUser) throw new ShopError(`出品できるのは ${MARKET_LIMITS.perUser} 品まで`, 400, 'limit_user');
    if (listings.filter((l) => sameTown(l.town, town)).length >= MARKET_LIMITS.perUserPerTown) throw new ShopError(`ひとつの街に 出せるのは ${MARKET_LIMITS.perUserPerTown} 品まで`, 400, 'limit_town');
    const listing: MarketListing = { id: input.rkey, town: { x: town.x, y: town.y }, pieceRkey: piece.rkey, itemId: piece.itemId, level: piece.level, price: input.price, listedAt: now };
    return { ...cur, pieces: rest, listings: [...listings, listing], shopOps: withOp(cur, opKey) };
  }, init ? { now, init } : { now });
  return { state, listing: (state.listings ?? []).find((l) => l.id === input.rkey), duplicate };
}

/**
 * 出品の手順 2: 街の RMW。棚に足す。足したら true。
 * listedAt から 5 分を過ぎた・取り下げの印がある・棚が満杯 のときは足さない (満杯なら印を残して二度と足さない)。
 */
export async function listOnShelf(env: GameStateEnv, seller: string, listing: MarketListing, now: number): Promise<boolean> {
  let onShelf = false;
  await modifyTownStock(env, listing.town, (cur) => {
    if (cur.listings.some((l) => sameListing(l, seller, listing.id))) { onShelf = true; return cur; }
    onShelf = false;
    if (cur.sales.some((s) => s.seller === seller && s.listingId === listing.id)) return cur;
    if (cur.closed.some((c) => sameListing(c, seller, listing.id))) return cur;
    if (now - listing.listedAt > LISTING_WRITE_WINDOW_SEC) return cur;
    // 棚も売上も 200 件まで (受け取られていない売上がたまっても、レコードの大きさが決まった範囲に収まる)。
    if (cur.listings.length >= MARKET_LIMITS.perTown || cur.sales.length >= MARKET_LIMITS.perTown) return { ...cur, closed: [...cur.closed, { id: listing.id, seller, at: now }] };
    const shelf: ShelfListing = { id: listing.id, seller, itemId: listing.itemId, level: listing.level, price: listing.price, listedAt: listing.listedAt };
    onShelf = true;
    return { ...cur, listings: [...cur.listings, shelf] };
  }, now);
  return onShelf;
}

/**
 * 出品する。値段は出品者が決める (1 以上の整数)。棚が満杯なら断り、品は照合で持ち物に戻す。
 * 同じ rkey の再送は 1 回分だけ (手順 2 が途中で止まっていたら、ここで続きを書く)。
 */
export async function marketList(env: GameStateEnv, did: string, input: { pieceRkey: string; price: unknown; rkey: string; pos?: Pos }, now: number, init?: Init): Promise<MarketListResult> {
  assertMarketRkey(input.rkey);
  if (!isValidMarketPrice(input.price)) throw new ShopError('値段は 1 以上の整数で', 400, 'bad_price');
  const seller = await listOnSeller(env, did, { pieceRkey: input.pieceRkey, price: input.price, rkey: input.rkey, ...(input.pos ? { pos: input.pos } : {}) }, now, init);
  // 再送だが、もう照合で片づいた (戻った・売れた) 品。
  if (!seller.listing) return { pieces: seller.state.pieces ?? [], listings: seller.state.listings ?? [], returned: [], sold: [], power: seller.state.power, duplicate: true, onShelf: false };
  const onShelf = await listOnShelf(env, did, seller.listing, now);
  if (onShelf) return { pieces: seller.state.pieces ?? [], listings: seller.state.listings ?? [], returned: [], sold: [], power: seller.state.power, listing: seller.listing, duplicate: seller.duplicate, onShelf };
  const mine = await marketReconcile(env, did, now, init);
  if (mine.returned.some((l) => l.id === seller.listing!.id)) throw new ShopError(`この街の棚は いっぱいだ (${MARKET_LIMITS.perTown} 品)`, 400, 'shelf_full');
  return { ...mine, listing: seller.listing, duplicate: seller.duplicate, onShelf };
}

/** 取り下げる。棚から外して印を残し、照合で持ち物に戻す。もう売れていたら断る。 */
export async function marketCancel(env: GameStateEnv, did: string, input: { listingId: string }, now: number, init?: Init): Promise<MarketMineResult> {
  assertMarketRkey(input.listingId);
  const rec = await readState(env, did);
  const listing = rec?.state.listings?.find((l) => l.id === input.listingId);
  if (!listing) throw new ShopError('その品は 出品していない', 400, 'not_listed');
  let sold = false;
  await modifyTownStock(env, listing.town, (cur) => {
    sold = cur.sales.some((s) => s.seller === did && s.listingId === listing.id);
    if (sold) return cur;
    if (cur.closed.some((c) => sameListing(c, did, listing.id))) return cur;
    return { ...cur, listings: cur.listings.filter((l) => !sameListing(l, did, listing.id)), closed: [...cur.closed, { id: listing.id, seller: did, at: now }] };
  }, now);
  if (sold) throw new ShopError('その品は もう売れた', 409, 'already_sold');
  return marketReconcile(env, did, now, init);
}

/** 照合で決める、出品 1 件の行き先。'keep' はそのまま。'return' は持ち物に戻す。売れていれば売上を返す。 */
export function listingFate(listing: MarketListing, seller: string, stock: TownStock | null, now: number): 'keep' | 'return' | ShelfSale {
  const sale = stock?.sales.find((s) => s.seller === seller && s.listingId === listing.id);
  if (sale) return sale;
  if (stock?.listings.some((l) => sameListing(l, seller, listing.id))) return 'keep';
  if (stock?.closed.some((c) => sameListing(c, seller, listing.id))) return 'return';
  return now - listing.listedAt > LISTING_SETTLE_SEC ? 'return' : 'keep';
}

/**
 * 照合 (店を開いたとき)。自分の listings にある街の棚を読み (同じ街はまとめる)、
 * 売れた品はパワー floor(値段 × 0.9) を受け取り、棚に無い品は持ち物に戻す。書くのは 1 回だけ。
 * 二重に払わない・二重に戻さない目印は「listings にまだその品がある」ことだけ (shopOps の枠に頼らない)。
 */
export async function marketReconcile(env: GameStateEnv, did: string, now: number, init?: Init): Promise<MarketMineResult> {
  const rec = await readState(env, did);
  const listings = rec?.state.listings ?? [];
  const unchanged = (st: GameState | undefined): MarketMineResult => ({ pieces: st?.pieces ?? [], listings: st?.listings ?? [], returned: [], sold: [], power: st?.power ?? 0 });
  if (!rec || listings.length === 0) return unchanged(rec?.state);
  const stocks = new Map<string, TownStock | null>();
  for (const l of listings) {
    const k = townStockRkey(l.town);
    if (!stocks.has(k)) stocks.set(k, (await readTownStock(env, l.town))?.stock ?? null);
  }
  const fates = new Map(listings.map((l) => [l.id, listingFate(l, did, stocks.get(townStockRkey(l.town)) ?? null, now)] as const));
  if ([...fates.values()].every((f) => f === 'keep')) return unchanged(rec.state);
  let returned: MarketListing[] = [];
  let sold: MarketSoldNotice[] = [];
  const next = await readModifyWrite(env, did, (cur) => {
    const mine = cur.listings ?? [];
    returned = mine.filter((l) => fates.get(l.id) === 'return');
    sold = mine.flatMap((l) => {
      const f = fates.get(l.id);
      return typeof f === 'object' ? [{ listingId: l.id, itemId: l.itemId, level: l.level, price: f.price, take: marketSellerTake(f.price), buyer: f.buyer }] : [];
    });
    if (returned.length === 0 && sold.length === 0) return cur;
    const done = new Set([...returned.map((l) => l.id), ...sold.map((s) => s.listingId)]);
    // pieces + listings の数は変わらない (heldPieceCount)。上限はそこで数えているので、戻して溢れることはない。
    const pieces = [...(cur.pieces ?? []), ...returned.map((l) => ({ rkey: l.pieceRkey, itemId: l.itemId, level: l.level }))];
    return { ...cur, power: cur.power + sold.reduce((n, s) => n + s.take, 0), pieces, listings: mine.filter((l) => !done.has(l.id)) };
  }, init ? { now, init } : { now });
  return { pieces: next.pieces ?? [], listings: next.listings ?? [], returned, sold, power: next.power };
}

/** 棚の品を安い順に (同じ値段は先に出したほうから)。GET /api/market/town が返す。 */
export function shelfCheapestFirst(stock: TownStock | null): ShelfListing[] {
  return [...(stock?.listings ?? [])].sort((a, b) => a.price - b.price || a.listedAt - b.listedAt);
}
