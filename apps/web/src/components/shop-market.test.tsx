// @vitest-environment jsdom
/** D-MARKET-001 PR4: なんでも屋の「中古」「うる」(shop-market.tsx) と ShopModal のタブ・売れた知らせ。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EQUIPMENT, MARKET_LIMITS, marketPrice, marketSellerTake, EQUIPMENT_BY_ID, maxShopGradeForTier, tierForRegion, worldOverlay } from '@aozoraquest/core';
import { ShopModal } from './shop-modal';
import type { MarketView } from '@/lib/use-market';
import type { MarketShelfItem } from '@/lib/market-server';

const handles: Record<string, { handle: string | null; state: 'resolved' | 'transient' | 'deleted' | 'loading' }> = {
  'did:plc:bob': { handle: 'bob.bsky.social', state: 'resolved' },
  'did:plc:gone': { handle: null, state: 'deleted' },
};
vi.mock('@/lib/handle-cache', () => ({ useHandle: (did: string | null) => (did ? handles[did] ?? { handle: null, state: 'transient' } : { handle: null, state: 'loading' }) }));

const towns = worldOverlay().towns;
const town = towns.find((t) => maxShopGradeForTier(tierForRegion(t.region)) === 1)!;
const KNIFE = EQUIPMENT_BY_ID['wp-knife']!;
const grade2 = EQUIPMENT.find((e) => e.grade === 2 && !e.jobOnly)!;
const ME = 'did:plc:me';
const item = (over: Partial<MarketShelfItem>): MarketShelfItem => ({ id: 'L1', seller: 'did:plc:bob', itemId: KNIFE.id, level: 2, price: 30, listedAt: 1, ...over });

const market = (over: Partial<MarketView> = {}): MarketView => ({ me: ME, shelf: [], listings: [], busy: false, error: null, sold: [], bought: null, buy: vi.fn(), list: vi.fn(), cancel: vi.fn(), ...over });
const view = (m: MarketView, extra: { pieces?: Array<{ rkey: string; itemId: string; level: number; at: string }>; equippedRkeys?: string[]; balance?: number } = {}) => render(
  <ShopModal town={town} townIndex={0} archetype={'warrior'} balance={extra.balance ?? 100} materials={{}} pieces={extra.pieces ?? []} equippedRkeys={extra.equippedRkeys ?? []}
    busy={false} lastAction={null} errorText={null} onCraft={vi.fn()} onForge={vi.fn()} onSell={vi.fn()} onBuy={vi.fn()} onClose={vi.fn()} market={m} />,
);

describe('ShopModal のタブ (D-MARKET-001)', () => {
  afterEach(cleanup);

  it('店の名前の下に「みせ」「中古」「うる」のタブがあり、最初は「みせ」', () => {
    view(market());
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['みせ', '中古', 'うる']);
    expect(screen.getByRole('tab', { name: 'みせ' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'つくってもらう' }).length).toBeGreaterThan(0);
  });
});

describe('中古 (D-MARKET-001)', () => {
  afterEach(cleanup);

  it('1 行に 名前・効果・「パワー◯ ・ @handle」。handle は Bluesky のプロフィールへ。「かう」→「かう!」で買う', () => {
    const m = market({ shelf: [item({})] });
    view(m);
    fireEvent.click(screen.getByRole('tab', { name: '中古' }));
    expect(screen.getByText('ナイフ+2')).toBeTruthy();
    expect(screen.getByText('パワー30 ・')).toBeTruthy();
    const link = screen.getByRole('link', { name: '@bob.bsky.social' });
    expect(link.getAttribute('href')).toBe('https://bsky.app/profile/did:plc:bob');
    fireEvent.click(screen.getByRole('button', { name: 'かう' }));
    expect(m.buy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'かう!' }));
    expect(m.buy).toHaveBeenCalledWith(item({}));
  });

  it('handle が解決できなければ「だれか」。自分の品は「じぶんの」で買えない。パワーが足りなければ押せない', () => {
    view(market({ shelf: [item({ id: 'a', seller: 'did:plc:gone' }), item({ id: 'b', seller: ME }), item({ id: 'c', price: 999 })] }), { balance: 100 });
    fireEvent.click(screen.getByRole('tab', { name: '中古' }));
    expect(screen.getAllByRole('link', { name: 'だれか' }).length).toBe(3 - 1);
    expect(screen.getByText('じぶんの')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'かう' }) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(buttons[1]!.disabled).toBe(true);
  });
});

describe('うる (D-MARKET-001)', () => {
  afterEach(cleanup);
  const pieces = [
    { rkey: 'k1', itemId: KNIFE.id, level: 3, at: '' },
    { rkey: 'k2', itemId: KNIFE.id, level: 0, at: '' },
    { rkey: 's1', itemId: 'wp-star-sword', level: 0, at: '' },
    { rkey: 'g2', itemId: grade2.id, level: 0, at: '' },
  ];

  it(`「出品中 n/${MARKET_LIMITS.perUser}（この街 n/${MARKET_LIMITS.perUserPerTown}）」と、値段の欄に目安 marketPrice が最初から入る`, () => {
    view(market({ listings: [{ id: 'X', town: { x: town.x, y: town.y }, pieceRkey: 'z', itemId: KNIFE.id, level: 0, price: 4, listedAt: 1 }] }), { pieces });
    fireEvent.click(screen.getByRole('tab', { name: 'うる' }));
    expect(screen.getByText(/出品中 1\/20（この街 1\/2）/)).toBeTruthy();
    const input = screen.getByLabelText('ナイフ+3のねだん') as HTMLInputElement;
    expect(input.value).toBe(String(marketPrice(KNIFE, 3)));
    expect(screen.getByText(`めやす${marketPrice(KNIFE, 3)}・手取り${marketSellerTake(marketPrice(KNIFE, 3))}`)).toBeTruthy();
  });

  it('値段は出品者が決める。「うる」→「出品する!」で、その値段で出す。0 や小数では押せない', () => {
    const m = market();
    view(m, { pieces: [pieces[0]!] });
    fireEvent.click(screen.getByRole('tab', { name: 'うる' }));
    const input = screen.getByLabelText('ナイフ+3のねだん');
    fireEvent.change(input, { target: { value: '0' } });
    expect((screen.getByRole('button', { name: 'うる' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '2.5' } });
    expect((screen.getByRole('button', { name: 'うる' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '77' } });
    expect(screen.getByText(`めやす${marketPrice(KNIFE, 3)}・手取り69`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'うる' }));
    fireEvent.click(screen.getByRole('button', { name: '出品する!' }));
    expect(m.list).toHaveBeenCalledWith(pieces[0], 77);
  });

  it('出せない品は理由を薄い字で: そうび中・カジノの けいひん・この街では あつかえない', () => {
    view(market(), { pieces, equippedRkeys: ['k2'] });
    fireEvent.click(screen.getByRole('tab', { name: 'うる' }));
    expect(screen.getByText('そうび中')).toBeTruthy();
    expect(screen.getByText('カジノの けいひんは うれない')).toBeTruthy();
    expect(screen.getByText('この街では あつかえない')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'うる' })).toHaveLength(1);
  });

  it('この街に 2 品出していたら「うる」は押せない。自分の出品に「とりさげ」', () => {
    const mine = [0, 1].map((i) => ({ id: `T${i}`, town: { x: town.x, y: town.y }, pieceRkey: `z${i}`, itemId: KNIFE.id, level: 1, price: 9, listedAt: 1 }));
    const m = market({ listings: mine });
    view(m, { pieces: [pieces[0]!] });
    fireEvent.click(screen.getByRole('tab', { name: 'うる' }));
    expect((screen.getByRole('button', { name: 'うる' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'とりさげ' })[0]!);
    expect(m.cancel).toHaveBeenCalledWith(mine[0]);
  });
});

describe('売れた知らせ (D-MARKET-001)', () => {
  afterEach(cleanup);

  it('店のセリフ窓に「◯◯ が @buyer に 売れた！ パワー+N」', () => {
    view(market({ sold: [{ listingId: 'L1', itemId: KNIFE.id, level: 3, price: 40, take: 36, buyer: 'did:plc:bob' }] }));
    expect(screen.getByText('ナイフ+3が @bob.bsky.social に 売れた！ パワー+36')).toBeTruthy();
  });
});
