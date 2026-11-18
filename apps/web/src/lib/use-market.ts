/**
 * なんでも屋の「中古」「うる」の状態と操作 (D-MARKET-001)。店を開いたときに 1 回だけ照合 (売上の受け取り・品の返却)
 * と棚の読み込みをする (定期的な読み直しはしない)。パワーと持ち物の正はサーバーが返した値。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Agent } from '@atproto/api';
import { marketBuy, marketCancel, marketList, marketMine, marketTown, newMarketRkey, type MarketMine, type MarketMyListing, type MarketShelfItem, type MarketSold } from './market-server';
import { WorldServerError, type ServerOwnedPiece } from './world-server';
import type { CraftedPiece } from './crafting';

/** ShopModal に渡す、市場の見た目と操作。 */
export interface MarketView {
  me: string | null;
  shelf: MarketShelfItem[] | null;
  listings: MarketMyListing[];
  busy: boolean;
  error: string | null;
  /** 開いたときに受け取った売上 (「売れた！」の知らせ)。 */
  sold: MarketSold[];
  /** 「中古」で買えた品 (知らせ用)。 */
  bought: { itemId: string; level: number } | null;
  buy: (item: MarketShelfItem) => void;
  list: (piece: CraftedPiece, price: number) => void;
  cancel: (listing: MarketMyListing) => void;
}

const errText = (e: unknown, fallback: string) => (e instanceof WorldServerError && e.message ? `${e.message}。` : `${fallback} (通信エラー)。もういちどどうぞ。`);

export function useMarket({ agent, did, tokenRef, setServerPower, onPieces, openTown }: {
  agent: Agent | null;
  /** 開いている店の街 (閉じていれば null)。開いた・街が変わったときに 1 回だけ照合と棚の読み込みをする。 */
  openTown: { x: number; y: number } | null;
  did: string | null;
  tokenRef: MutableRefObject<string | undefined>;
  setServerPower: (power: number) => void;
  onPieces: (pieces: ServerOwnedPiece[]) => void;
}) {
  const [shelf, setShelf] = useState<MarketShelfItem[] | null>(null);
  const [listings, setListings] = useState<MarketMyListing[]>([]);
  const [sold, setSold] = useState<MarketSold[]>([]);
  const [bought, setBought] = useState<{ itemId: string; level: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const townRef = useRef<{ x: number; y: number } | null>(null);
  /** 通信が切れたときだけ同じ rkey で送り直す (二重に出品・購入しない)。 */
  const pending = useRef(new Map<string, string>());

  const applyMine = useCallback((m: MarketMine) => {
    setListings(m.listings);
    setServerPower(m.power);
    onPieces(m.pieces);
  }, [setServerPower, onPieces]);

  const reloadShelf = useCallback(async () => {
    const t = townRef.current;
    if (!t) return;
    try { setShelf(await marketTown(t)); } catch (e) { setError(errText(e, 'たなを よめなかった')); }
  }, []);

  /** 店を開いたとき。照合 (売上の受け取り・品の返却・止まった購入の返金) と棚の読み込み。 */
  const openMarket = useCallback((town: { x: number; y: number }) => {
    townRef.current = { x: town.x, y: town.y };
    setShelf(null); setSold([]); setBought(null); setError(null);
    void reloadShelf();
    if (!agent) return;
    void marketMine(agent).then((m) => { applyMine(m); setSold(m.sold); }, (e) => console.warn('[market] reconcile failed', e));
  }, [agent, applyMine, reloadShelf]);

  const run = useCallback(async (kind: string, fallback: string, call: (rkey: string) => Promise<void>) => {
    if (!agent) { setError('サーバーに接続できない。'); return; }
    const rkey = pending.current.get(kind) ?? newMarketRkey();
    pending.current.set(kind, rkey);
    setBusy(true); setError(null); setBought(null);
    try {
      await call(rkey);
      pending.current.delete(kind);
    } catch (e) {
      if (!(e instanceof WorldServerError && e.status === 0)) pending.current.delete(kind);
      setError(errText(e, fallback));
    } finally {
      setBusy(false);
      void reloadShelf();
    }
  }, [agent, reloadShelf]);

  const view: MarketView = useMemo(() => ({
    me: did, shelf, listings, busy, error, sold, bought,
    buy: (item) => void run(`buy:${item.seller}|${item.id}`, 'かえなかった', async (rkey) => {
      const r = await marketBuy(agent!, item, rkey, tokenRef.current);
      setServerPower(r.power); onPieces(r.pieces);
      if (r.bought) setBought({ itemId: item.itemId, level: item.level });
      else setError(r.pending ? 'まだ たしかめている。すこし まってから ひらきなおしてほしい。' : 'ほかの人が さきに かった。パワーは もどった。');
    }),
    list: (piece, price) => void run(`list:${piece.rkey}:${price}`, '出品できなかった', async (rkey) => {
      applyMine(await marketList(agent!, piece.rkey, price, rkey, tokenRef.current));
    }),
    cancel: (listing) => void run(`cancel:${listing.id}`, 'とりさげられなかった', async () => {
      applyMine(await marketCancel(agent!, listing.id));
    }),
  }), [agent, did, shelf, listings, busy, error, sold, bought, run, applyMine, setServerPower, onPieces, tokenRef]);

  const openKey = openTown ? `${openTown.x},${openTown.y}` : null;
  useEffect(() => { if (openTown) openMarket(openTown); }, [openKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return view;
}
