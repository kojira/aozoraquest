// なんでも屋の「中古」「うる」と売れた知らせ (D-MARKET-001) の 390px の見た目。本物の ShopModal に、決まった市場の状態を渡す。
// 出品者の @handle は handle-cache の localStorage に先に入れておく (公開 AppView を叩かない)。
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EQUIPMENT, maxShopGradeForTier, tierForRegion, worldOverlay } from '@aozoraquest/core';
import { ShopModal } from '../../src/components/shop-modal';
import type { MarketView } from '../../src/lib/use-market';
import type { MarketMyListing, MarketShelfItem } from '../../src/lib/market-server';
import '../../src/styles.css';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'used';
localStorage.setItem('aozora:shop-tutorial-done', '1');
const now = Date.now();
localStorage.setItem('aozoraquest:handleCache', JSON.stringify({
  'did:plc:bob': { handle: 'bob.bsky.social', ts: now },
  'did:plc:longname': { handle: 'a-very-long-handle-name-for-the-shelf.bsky.social', ts: now },
  'did:plc:me': { handle: 'me.bsky.social', ts: now },
}));

const town = worldOverlay().towns.find((t) => maxShopGradeForTier(tierForRegion(t.region)) === 1)!;
const ME = 'did:plc:me';
const g1 = EQUIPMENT.filter((e) => e.grade === 1 && !e.casinoOnly);
const shelf: MarketShelfItem[] = [
  { id: 'a', seller: 'did:plc:bob', itemId: 'wp-knife', level: 2, price: 7, listedAt: 1 },
  { id: 'b', seller: 'did:plc:longname', itemId: g1[3]!.id, level: 5, price: 52, listedAt: 2 },
  { id: 'c', seller: ME, itemId: 'sh-wood', level: 0, price: 60, listedAt: 3 },
  { id: 'd', seller: 'did:plc:unknown', itemId: 'ar-leather', level: 1, price: 120, listedAt: 4 },
];
const mine: MarketMyListing[] = view === 'cancel'
  ? [{ id: 'm1', town: { x: town.x, y: town.y }, pieceRkey: 'p9', itemId: 'ar-cloth', level: 3, price: 15, listedAt: 1 }]
  : [];
const pieces = [
  { rkey: 'p1', itemId: 'wp-knife', level: 3, at: '' },
  { rkey: 'p2', itemId: 'ar-leather', level: 0, at: '' },
  { rkey: 'p3', itemId: 'wp-star-sword', level: 0, at: '' },
  { rkey: 'p4', itemId: EQUIPMENT.find((e) => e.grade === 2 && !e.jobOnly)!.id, level: 1, at: '' },
];

function App() {
  const [listings, setListings] = useState(mine);
  const market: MarketView = {
    me: ME, shelf, listings, busy: false, error: null, bought: null,
    sold: view === 'sold' ? [{ listingId: 'x', itemId: 'wp-knife', level: 3, price: 40, take: 36, buyer: 'did:plc:bob' }] : [],
    buy: () => {}, list: () => {}, cancel: (l) => setListings((ls) => ls.filter((x) => x.id !== l.id)),
  };
  return (
    <div style={{ minHeight: '100svh', background: '#223' }}>
      <ShopModal town={town} townIndex={0} archetype="warrior" balance={80} materials={{}} pieces={pieces} equippedRkeys={['p2']}
        busy={false} lastAction={null} errorText={null} onCraft={() => {}} onForge={() => {}} onSell={() => {}} onBuy={() => {}} onClose={() => {}} market={market} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
