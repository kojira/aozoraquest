/**
 * 装備を街で売る (D-MARKET-001) の edge 呼び出し。出品・購入・照合の結果はサーバーが決める。画面はそれを見せるだけ。
 * rkey は 1 回の操作ごとに作り、通信が切れたときだけ同じ rkey で送り直す (二重に出品・購入しない)。
 */
import type { Agent } from '@atproto/api';
import { LXM } from '@aozoraquest/core';
import { EDGE_URL } from './edge-config';
import { callEdge, WorldServerError, type ServerOwnedPiece } from './world-server';

/** 街の棚の 1 品 (edge の ShelfListing)。seller は did。表示するときに @handle に直す。 */
export interface MarketShelfItem { id: string; seller: string; itemId: string; level: number; price: number; listedAt: number }
/** 自分の出品 (edge の MarketListing)。 */
export interface MarketMyListing { id: string; town: { x: number; y: number }; pieceRkey: string; itemId: string; level: number; price: number; listedAt: number }
/** 売れた知らせ。take は手数料 1 割を消したあとの手取り。 */
export interface MarketSold { listingId: string; itemId: string; level: number; price: number; take: number; buyer: string }

export interface MarketMine { pieces: ServerOwnedPiece[]; listings: MarketMyListing[]; returned: MarketMyListing[]; sold: MarketSold[]; power: number }
export interface MarketListRes extends MarketMine { listing?: MarketMyListing; duplicate: boolean; onShelf: boolean }
export interface MarketBuyRes { bought: boolean; duplicate: boolean; pending: boolean; power: number; pieces: ServerOwnedPiece[] }

/** 街の棚 (安い順)。認証なしで読む。 */
export async function marketTown(town: { x: number; y: number }): Promise<MarketShelfItem[]> {
  if (!EDGE_URL) throw new WorldServerError('サーバー権威 API 未設定', 0, 'not_configured');
  const res = await fetch(`${EDGE_URL}/api/market/town?x=${town.x}&y=${town.y}`).catch(() => null);
  if (!res) throw new WorldServerError('通信に失敗しました', 0, 'network');
  const data = (await res.json().catch(() => ({}))) as { listings?: MarketShelfItem[]; error?: string };
  if (!res.ok) throw new WorldServerError(data.error ?? `edge ${res.status}`, res.status, data.error);
  return data.listings ?? [];
}

export const marketMine = (agent: Agent) => callEdge<MarketMine>(agent, LXM.marketMine, '/api/market/mine', {});
export const marketList = (agent: Agent, pieceRkey: string, price: number, rkey: string, token?: string) =>
  callEdge<MarketListRes>(agent, LXM.marketList, '/api/market/list', { pieceRkey, price, rkey, ...(token ? { token } : {}) });
export const marketCancel = (agent: Agent, listingId: string) => callEdge<MarketMine>(agent, LXM.marketCancel, '/api/market/cancel', { listingId });
export const marketBuy = (agent: Agent, item: { seller: string; id: string }, rkey: string, token?: string) =>
  callEdge<MarketBuyRes>(agent, LXM.marketBuy, '/api/market/buy', { seller: item.seller, listingId: item.id, rkey, ...(token ? { token } : {}) });

/** 出品・購入の rkey (edge は 32 文字まで)。 */
export const newMarketRkey = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
