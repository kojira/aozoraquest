/**
 * 街の棚の品を買う (D-MARKET-001 §2)。買い手の記録と街の棚をまたぐので、3 回に分けて書く。
 *
 * 1. 買い手の RMW: パワーを引き、預かり `marketHolds` を足す (`buy-market:<rkey>` で冪等)
 * 2. 街の RMW: 棚にその品があり、出品者が自分でなく、預かりから 5 分以内なら、棚から `sales` に移す。
 *    同じ品を sales に移せるのは CAS に勝った 1 人だけ (二重に売れない)
 * 3. 買い手の RMW: sales に自分の op があれば品を、無ければパワーを返す
 *
 * 2 を走らせるのは、1 で預かりを作ったリクエストだけ (再送は 1 で「処理済み」になり、2 を走らせない)。
 * そのため、同じリクエストの 3 は 2 の結果だけを見て決めてよい。途中で止まった預かりは、
 * 10 分を過ぎてから照合 (`settleOldHolds`) で 3 と同じ決まりで片づける。2 は 5 分を過ぎたら受け付けないので、
 * 片づけたあとで売れることはない。
 * 出品者への支払いは、出品者が店を開いたときの照合 (market.ts の marketReconcile) で受け取る。
 */
import { emptyState, readModifyWrite, readState, type GameState, type GameStateEnv, type MarketHold, type OwnedPiece } from './game-state';
import { alreadyDone, heldPieceCount, MAX_OWNED_PIECES, shopAt, ShopError, withOp } from './shop';
import { assertMarketRkey, LISTING_SETTLE_SEC, LISTING_WRITE_WINDOW_SEC, modifyTownStock, readTownStock, sameListing, type ShelfSale } from './market-stock';

type Init = (did: string, nowIso: string) => Promise<GameState>;
type Pos = { x: number; y: number; mapId?: string };

/** 同時に持てる預かりの数。 */
export const MAX_MARKET_HOLDS = 3;
/** 書くついでに確かめる、片づけ候補の売上の数 (読むだけ。書き込み回数は増えない)。 */
const SALES_PRUNE_PER_WRITE = 4;

export interface MarketBuyResult {
  /** 買えたか (ほかの人が先に買った・取り下げられた なら false。パワーは全額戻っている)。 */
  bought: boolean;
  duplicate: boolean;
  /** まだ決まっていない (再送で、預かりが 10 分たっていない)。 */
  pending: boolean;
  power: number;
  pieces: OwnedPiece[];
}

const opKeyOf = (rkey: string) => `buy-market:${rkey}`;

/** 手順 1: 買い手の RMW。棚で見た品の値段でパワーを引き、預かりを足す。 */
async function holdOnBuyer(env: GameStateEnv, did: string, input: { seller: string; listingId: string; rkey: string; pos?: Pos }, now: number, init?: Init): Promise<{ state: GameState; hold: MarketHold | undefined; duplicate: boolean }> {
  let duplicate = false;
  let hold: MarketHold | undefined;
  // 品と値段は棚から読む (client の申告を信じない)。手順 2 で同じ品・同じ値段かを確かめ直す。
  const pre = await readState(env, did);
  const nowIso = new Date(now * 1000).toISOString();
  const town = shopAt(pre?.state ?? (init ? await init(did, nowIso) : emptyState(did, nowIso)), input.pos).town;
  const shelf = (await readTownStock(env, town))?.stock;
  const item = shelf?.listings.find((l) => sameListing(l, input.seller, input.listingId));
  const state = await readModifyWrite(env, did, (cur) => {
    if (alreadyDone(cur, opKeyOf(input.rkey))) { duplicate = true; hold = (cur.marketHolds ?? []).find((h) => h.op === input.rkey); return cur; }
    duplicate = false;
    if (input.seller === did) throw new ShopError('じぶんの品は かえない', 400, 'own_listing');
    if (!item) throw new ShopError('その品は もう無い', 409, 'gone');
    const holds = cur.marketHolds ?? [];
    if (holds.length >= MAX_MARKET_HOLDS) throw new ShopError('いま ほかの品を かっている。すこし まってほしい', 409, 'busy');
    if (cur.power < item.price) throw new ShopError('あおぞらパワーが たりない', 400, 'no_power');
    if (heldPieceCount(cur) >= MAX_OWNED_PIECES) throw new ShopError(`もちものが いっぱいだ (${MAX_OWNED_PIECES} 個)`, 400, 'pieces_full');
    if ((cur.pieces ?? []).some((p) => p.rkey === input.rkey)) throw new ShopError('rkey が不正', 400, 'bad_rkey');
    hold = { op: input.rkey, listingId: item.id, seller: item.seller, town: { x: town.x, y: town.y }, itemId: item.itemId, level: item.level, price: item.price, at: now };
    return { ...cur, power: cur.power - item.price, marketHolds: [...holds, hold], shopOps: withOp(cur, opKeyOf(input.rkey)) };
  }, init ? { now, init } : { now });
  return { state, hold, duplicate };
}

/**
 * 受け取りも返金も済んだ売上 (出品者の listings にも、買い手の預かりにも無い) を探す。読むだけ。
 * 古い順に SALES_PRUNE_PER_WRITE 件まで。
 */
async function settledSales(env: GameStateEnv, sales: readonly ShelfSale[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const s of [...sales].sort((a, b) => a.at - b.at).slice(0, SALES_PRUNE_PER_WRITE)) {
    const seller = (await readState(env, s.seller))?.state;
    const buyer = (await readState(env, s.buyer))?.state;
    if (!seller?.listings?.some((l) => l.id === s.listingId) && !buyer?.marketHolds?.some((h) => h.op === s.op)) out.add(`${s.seller}|${s.listingId}`);
  }
  return out;
}

/** 手順 2: 街の RMW。条件がそろえば棚から sales に移す。売れたら true。 */
export async function sellOnShelf(env: GameStateEnv, buyer: string, hold: MarketHold, now: number): Promise<boolean> {
  const before = (await readTownStock(env, hold.town))?.stock;
  const settled = before ? await settledSales(env, before.sales) : new Set<string>();
  let sold = false;
  await modifyTownStock(env, hold.town, (cur) => {
    const sales = cur.sales.filter((s) => !settled.has(`${s.seller}|${s.listingId}`));
    sold = sales.some((s) => s.buyer === buyer && s.op === hold.op);
    if (sold) return sales.length === cur.sales.length ? cur : { ...cur, sales };
    const item = cur.listings.find((l) => sameListing(l, hold.seller, hold.listingId));
    const ok = item && item.seller !== buyer && item.price === hold.price && item.itemId === hold.itemId && item.level === hold.level && now - hold.at <= LISTING_WRITE_WINDOW_SEC;
    if (!ok) return sales.length === cur.sales.length ? cur : { ...cur, sales };
    sold = true;
    const sale: ShelfSale = { listingId: item.id, seller: item.seller, buyer, op: hold.op, price: item.price, itemId: item.itemId, level: item.level, at: now };
    return { ...cur, listings: cur.listings.filter((l) => l !== item), sales: [...sales, sale] };
  }, now);
  return sold;
}

/** 手順 3: 買い手の RMW。売れていれば品を、売れていなければパワーを返し、預かりを消す。 */
async function settleHolds(env: GameStateEnv, did: string, ops: ReadonlyMap<string, boolean>, now: number, init?: Init): Promise<GameState> {
  return readModifyWrite(env, did, (cur) => {
    const holds = cur.marketHolds ?? [];
    const done = holds.filter((h) => ops.has(h.op));
    if (done.length === 0) return cur;
    const got = done.filter((h) => ops.get(h.op));
    const refund = done.filter((h) => !ops.get(h.op)).reduce((n, h) => n + h.price, 0);
    const pieces = [...(cur.pieces ?? []), ...got.map((h) => ({ rkey: h.op, itemId: h.itemId, level: h.level }))];
    return { ...cur, power: cur.power + refund, pieces, marketHolds: holds.filter((h) => !ops.has(h.op)) };
  }, init ? { now, init } : { now });
}

/** 預かりの op ごとに、売れたか (街の棚の sales に自分の op があるか)。 */
async function holdOutcomes(env: GameStateEnv, did: string, holds: readonly MarketHold[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (const h of holds) {
    const stock = (await readTownStock(env, h.town))?.stock;
    out.set(h.op, !!stock?.sales.some((s) => s.buyer === did && s.op === h.op));
  }
  return out;
}

/**
 * 棚の品を買う。品と値段は棚から読み、値段は出品者が決めた値。同じ rkey の再送は 1 回分だけ。
 * ほかの人が先に買っていたら、パワーは全額戻る (bought: false)。
 */
export async function marketBuy(env: GameStateEnv, did: string, input: { seller: unknown; listingId: unknown; rkey: unknown; pos?: Pos }, now: number, init?: Init): Promise<MarketBuyResult> {
  assertMarketRkey(input.rkey);
  assertMarketRkey(input.listingId);
  if (typeof input.seller !== 'string' || !input.seller.startsWith('did:')) throw new ShopError('出品者が不正', 400, 'bad_request');
  const step1 = await holdOnBuyer(env, did, { seller: input.seller, listingId: input.listingId, rkey: input.rkey, ...(input.pos ? { pos: input.pos } : {}) }, now, init);
  const result = (st: GameState, bought: boolean, pending = false): MarketBuyResult => ({ bought, duplicate: step1.duplicate, pending, power: st.power, pieces: st.pieces ?? [] });
  if (step1.duplicate) {
    // 再送は手順 2 を走らせない。預かりが残っていれば、10 分を過ぎるまで待ってもらう。
    if (!step1.hold) return result(step1.state, (step1.state.pieces ?? []).some((p) => p.rkey === input.rkey));
    if (now - step1.hold.at <= LISTING_SETTLE_SEC) return result(step1.state, false, true);
    const st = await settleHolds(env, did, await holdOutcomes(env, did, [step1.hold]), now, init);
    return result(st, (st.pieces ?? []).some((p) => p.rkey === input.rkey));
  }
  const hold = step1.hold!;
  const sold = await sellOnShelf(env, did, hold, now);
  const st = await settleHolds(env, did, new Map([[hold.op, sold]]), now, init);
  return result(st, sold);
}

/** 照合: 10 分を過ぎた預かりを手順 3 と同じ決まりで片づける (途中で止まった購入の返金)。 */
export async function settleOldHolds(env: GameStateEnv, did: string, now: number, init?: Init): Promise<GameState | null> {
  const st = (await readState(env, did))?.state;
  const old = (st?.marketHolds ?? []).filter((h) => now - h.at > LISTING_SETTLE_SEC);
  if (!st || old.length === 0) return st ?? null;
  return settleHolds(env, did, await holdOutcomes(env, did, old), now, init);
}
