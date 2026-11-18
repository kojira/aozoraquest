/**
 * 街の棚 townStock (D-MARKET-001 §3)。サーバー repo に 1 街 1 レコード、rkey は `<x>_<y>`。
 *
 * - collection は Worker env で dev と本番を分ける (D-ENV-002): dev = `app.aozoraquest.dev.townStock`、
 *   本番 = `app.aozoraquest.townStock`。gameState と同じ `adminNsidRoot(env)` で決め、リクエストのヘッダでは決めない
 * - 書き込みは GameState と同じ CAS ループ (cas-record.ts)。最初の出品のときに作る (swapRecord:null)
 * - 棚の品は (seller, id) で 1 つに決まる。id は出品者の端末が決めた rkey
 */
import { getRecord } from './pds';
import { readServerTokens } from './oauth-store';
import { ServerWriteError } from './server-pds';
import { casRecordLoop } from './cas-record';
import { adminNsidRoot } from './world-authoring';
import type { GameStateEnv } from './game-state';
import { ShopError } from './shop';

export const TOWN_STOCK_VERSION = 1;

/** 出品・購入の rkey の長さの上限。棚 1 つの大きさを決める (200 品 + 売上 200 件 + 印 200 件で 120KB 未満。market.test が守る)。 */
export const MARKET_RKEY_MAX = 32;
/** 取り下げの印を残す件数の上限 (新しいほうから)。 */
export const MAX_CLOSED_MARKS = 200;

/** 出品の書き込み (街の RMW) を受け付ける時間。出品者の RMW の listedAt からこれを過ぎたら棚に足さない。 */
export const LISTING_WRITE_WINDOW_SEC = 5 * 60;
/** 照合で「棚に届かなかった」と見なすまでの時間。LISTING_WRITE_WINDOW_SEC より長くして、遅れて届く書き込みと食い違わないようにする。 */
export const LISTING_SETTLE_SEC = 10 * 60;

/** 棚に並ぶ 1 品。 */
export interface ShelfListing {
  id: string;
  seller: string;
  itemId: string;
  level: number;
  price: number;
  listedAt: number;
}

/** 売れた品 (PR3 で使う)。出品者が受け取るまで残る。 */
export interface ShelfSale {
  listingId: string;
  seller: string;
  buyer: string;
  op: string;
  price: number;
  itemId: string;
  level: number;
  at: number;
}

/** 棚から外した品 (取り下げ・管理者の非表示) の印。遅れて届いた出品の書き込みを断るために LISTING_SETTLE_SEC だけ残す。 */
export interface ShelfClosed {
  id: string;
  seller: string;
  at: number;
}

export interface TownStock {
  version: number;
  town: { x: number; y: number };
  listings: ShelfListing[];
  sales: ShelfSale[];
  closed: ShelfClosed[];
  updatedAt: string;
}

/** townStock の collection (D-ENV-002)。 */
export function townStockCollection(env: GameStateEnv): string {
  return `${adminNsidRoot(env)}.townStock`;
}

export function townStockRkey(town: { x: number; y: number }): string {
  return `${town.x}_${town.y}`;
}

export function emptyTownStock(town: { x: number; y: number }, nowIso: string): TownStock {
  return { version: TOWN_STOCK_VERSION, town: { x: town.x, y: town.y }, listings: [], sales: [], closed: [], updatedAt: nowIso };
}

/** 古いレコードや欠けた欄を今の形にそろえる。 */
function normalizeStock(v: Partial<TownStock>, town: { x: number; y: number }): TownStock {
  return { version: v.version ?? TOWN_STOCK_VERSION, town: v.town ?? { x: town.x, y: town.y }, listings: v.listings ?? [], sales: v.sales ?? [], closed: v.closed ?? [], updatedAt: v.updatedAt ?? '' };
}

/** 街の棚を読む (無ければ null)。repo は書き込みと同じトークン由来 (readState と同じ作法)。 */
export async function readTownStock(env: GameStateEnv, town: { x: number; y: number }): Promise<{ stock: TownStock; cid: string } | null> {
  if (!env.OAUTH_TOKENS) throw new ServerWriteError('KV 未 binding', 'no-kv');
  const tokens = await readServerTokens(env.OAUTH_TOKENS);
  if (!tokens) throw new ServerWriteError('サーバートークン未 bootstrap (管理画面で OAuth 連携が必要)', 'not-bootstrapped');
  const rec = await getRecord<Partial<TownStock>>(tokens.pdsUrl, tokens.did, townStockCollection(env), townStockRkey(town));
  return rec ? { stock: normalizeStock(rec.value, town), cid: rec.cid } : null;
}

/**
 * 街の棚の read-modify-write。mutate が受け取った値をそのまま返したら書かない (棚がまだ無いときも作らない)。
 * 書くついでに、期限を過ぎた closed の印を捨てる。
 */
export async function modifyTownStock(env: GameStateEnv, town: { x: number; y: number }, mutate: (cur: TownStock) => TownStock, now: number): Promise<TownStock> {
  const nowIso = new Date(now * 1000).toISOString();
  return casRecordLoop<TownStock>(env, {
    collection: townStockCollection(env),
    rkey: townStockRkey(town),
    now,
    retries: 5,
    read: async () => {
      const rec = await readTownStock(env, town);
      return rec ? { value: rec.stock, cid: rec.cid } : null;
    },
    fresh: async () => emptyTownStock(town, nowIso),
    mutate,
    stamp: (next) => ({ ...next, closed: next.closed.filter((c) => now - c.at <= LISTING_SETTLE_SEC).slice(-MAX_CLOSED_MARKS), version: TOWN_STOCK_VERSION, updatedAt: nowIso }),
    writeWhenCreated: false,
  });
}

/** 出品・購入の rkey (棚の大きさを決めるので短く)。 */
export function assertMarketRkey(rkey: unknown): asserts rkey is string {
  if (typeof rkey !== 'string' || !/^[A-Za-z0-9._:~-]+$/.test(rkey) || rkey.length > MARKET_RKEY_MAX) throw new ShopError('rkey が不正', 400, 'bad_rkey');
}

/** 同じ品か (棚の品は seller と id の組で 1 つ)。 */
export const sameListing = (a: { seller: string; id: string }, seller: string, id: string): boolean => a.seller === seller && a.id === id;
