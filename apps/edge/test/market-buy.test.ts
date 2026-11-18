/**
 * D-MARKET-001 PR3: 棚の品を買う (market-buy.ts) と、出品者の売上の受け取り (market.ts の marketReconcile)。
 * PDS は fetch の差し替え (support/market-env.ts)。CAS (swapRecord) は本物と同じ形で見る。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { marketSellerTake } from '@aozoraquest/core';
import { marketList, marketReconcile } from '../src/market';
import { marketBuy, sellOnShelf, settleOldHolds } from '../src/market-buy';
import { DEV_STOCK, DID, GS, ITEM, makeEnv, NOW, seedGs, serverPds } from './support/market-env';

const BOB = 'did:plc:bob';
const CAROL = 'did:plc:carol';
const PRICE = 40;

/** アリスが p1 を 40 で出品した世界。ボブとキャロルは同じ街にいて、パワー 100。 */
async function world() {
  const env = await makeEnv();
  const pds = serverPds({ ...seedGs(GS({ power: 10 })), ...seedGs(GS({ did: BOB, power: 100, pieces: [] }), BOB), ...seedGs(GS({ did: CAROL, power: 100, pieces: [] }), CAROL) });
  globalThis.fetch = pds.fn;
  await marketList(env, DID, { pieceRkey: 'p1', price: PRICE, rkey: 'L1' }, NOW);
  return { env, pds };
}
const totalPower = (pds: Awaited<ReturnType<typeof world>>['pds']) => [DID, BOB, CAROL].reduce((n, d) => n + pds.gs(d).power, 0);

describe('D-MARKET-001 買う (marketBuy)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('2 人が同時に買うと、品を得るのは 1 人だけで、もう 1 人にはパワーが全額戻る', async () => {
    const { env, pds } = await world();
    // 2 人とも棚を読んでから書く (先に書いたほうが勝ち、負けたほうは CAS で読み直す)
    let waiting: Array<() => void> = [];
    pds.setBeforePut(async (c) => {
      if (c !== DEV_STOCK) return;
      if (waiting.length === 0) { await new Promise<void>((r) => waiting.push(r)); return; }
      waiting.forEach((r) => r()); waiting = [];
    });
    const [b, c] = await Promise.all([
      marketBuy(env, BOB, { seller: DID, listingId: 'L1', rkey: 'B1' }, NOW + 5),
      marketBuy(env, CAROL, { seller: DID, listingId: 'L1', rkey: 'C1' }, NOW + 5),
    ]);
    expect([b.bought, c.bought].filter(Boolean)).toHaveLength(1);
    const [winner, loser] = b.bought ? [BOB, CAROL] : [CAROL, BOB];
    expect(pds.gs(winner).power).toBe(100 - PRICE);
    expect(pds.gs(winner).pieces).toEqual([{ rkey: winner === BOB ? 'B1' : 'C1', itemId: ITEM, level: 0 }]);
    expect(pds.gs(loser).power).toBe(100);
    expect(pds.gs(loser).pieces).toEqual([]);
    expect(pds.gs(winner).marketHolds).toEqual([]);
    expect(pds.gs(loser).marketHolds).toEqual([]);
    expect(pds.shelf()!.listings).toEqual([]);
    expect(pds.shelf()!.sales).toHaveLength(1);
  });

  it('売り買いの前後で、関わった人のパワーの合計は 1 割減る (出品者は floor(値段 × 0.9))', async () => {
    const { env, pds } = await world();
    const before = totalPower(pds);
    expect((await marketBuy(env, BOB, { seller: DID, listingId: 'L1', rkey: 'B1' }, NOW + 5)).bought).toBe(true);
    const r = await marketReconcile(env, DID, NOW + 60);
    expect(r.sold).toEqual([{ listingId: 'L1', itemId: ITEM, level: 0, price: PRICE, take: 36, buyer: BOB }]);
    expect(pds.gs(DID).power).toBe(10 + marketSellerTake(PRICE));
    expect(totalPower(pds)).toBe(before - (PRICE - marketSellerTake(PRICE)));
    expect(totalPower(pds)).toBeLessThan(before);
    expect(pds.gs(DID).listings).toEqual([]);
  });

  it('自分の品は買えない', async () => {
    const { env, pds } = await world();
    await expect(marketBuy(env, DID, { seller: DID, listingId: 'L1', rkey: 'A9' }, NOW + 5)).rejects.toMatchObject({ code: 'own_listing' });
    expect(pds.gs(DID).power).toBe(10);
    expect(pds.shelf()!.listings).toHaveLength(1);
  });

  it('値段は棚の値 (client が送った値段は使わない)。パワーが足りなければ買えない・無い品は買えない', async () => {
    const { env, pds } = await world();
    const r = await marketBuy(env, BOB, { seller: DID, listingId: 'L1', rkey: 'B1', price: 1 } as never, NOW + 5);
    expect(r.power).toBe(100 - PRICE);
    await marketList(env, DID, { pieceRkey: 'p2', price: 101, rkey: 'L2' }, NOW + 6);
    await expect(marketBuy(env, CAROL, { seller: DID, listingId: 'L2', rkey: 'C1' }, NOW + 7)).rejects.toMatchObject({ code: 'no_power' });
    expect(pds.gs(CAROL).power).toBe(100);
    await expect(marketBuy(env, CAROL, { seller: DID, listingId: 'nope', rkey: 'C2' }, NOW + 7)).rejects.toMatchObject({ code: 'gone' });
  });

  it('手順 1 のあとで止まった購入は、10 分を過ぎた照合で全額戻り、そのあとで売れることはない', async () => {
    const { env, pds } = await world();
    pds.setFailPut((c) => c === DEV_STOCK);
    await expect(marketBuy(env, BOB, { seller: DID, listingId: 'L1', rkey: 'B1' }, NOW + 5)).rejects.toThrow();
    pds.setFailPut(() => false);
    expect(pds.gs(BOB).power).toBe(100 - PRICE); // 預かり中
    const hold = pds.gs(BOB).marketHolds![0]!;
    expect(hold).toMatchObject({ op: 'B1', listingId: 'L1', price: PRICE });
    await settleOldHolds(env, BOB, NOW + 5 + 9 * 60);
    expect(pds.gs(BOB).power).toBe(100 - PRICE); // 10 分たつまでは片づけない
    // 同じ rkey の再送は手順 2 を走らせず、待ってもらう
    expect((await marketBuy(env, BOB, { seller: DID, listingId: 'L1', rkey: 'B1' }, NOW + 60)).pending).toBe(true);
    await settleOldHolds(env, BOB, NOW + 5 + 10 * 60 + 1);
    expect(pds.gs(BOB).power).toBe(100);
    expect(pds.gs(BOB).marketHolds).toEqual([]);
    expect(pds.gs(BOB).pieces).toEqual([]);
    // 遅れて届いた手順 2 は 5 分を過ぎているので受け付けない
    expect(await sellOnShelf(env, BOB, hold, NOW + 5 + 10 * 60 + 2)).toBe(false);
    expect(pds.shelf()!.listings).toHaveLength(1);
    // 2 回照合しても 2 回は戻らない
    await settleOldHolds(env, BOB, NOW + 30 * 60);
    expect(pds.gs(BOB).power).toBe(100);
  });

  it('同じ rkey で 2 回買っても 1 回分だけ', async () => {
    const { env, pds } = await world();
    await marketBuy(env, BOB, { seller: DID, listingId: 'L1', rkey: 'B1' }, NOW + 5);
    const again = await marketBuy(env, BOB, { seller: DID, listingId: 'L1', rkey: 'B1' }, NOW + 6);
    expect(again).toMatchObject({ duplicate: true, bought: true, pending: false });
    expect(pds.gs(BOB).power).toBe(100 - PRICE);
    expect(pds.gs(BOB).pieces).toHaveLength(1);
  });
});

describe('D-MARKET-001 売上の受け取り (marketReconcile)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('受け取りを 2 回してもパワーは 1 回分', async () => {
    const { env, pds } = await world();
    await marketBuy(env, BOB, { seller: DID, listingId: 'L1', rkey: 'B1' }, NOW + 5);
    await marketReconcile(env, DID, NOW + 60);
    const again = await marketReconcile(env, DID, NOW + 61);
    expect(again.sold).toEqual([]);
    expect(pds.gs(DID).power).toBe(10 + marketSellerTake(PRICE));
  });

  it('受け取りと返金が済んだ売上は、次に街を書くついでに棚から消える', async () => {
    const { env, pds } = await world();
    await marketBuy(env, BOB, { seller: DID, listingId: 'L1', rkey: 'B1' }, NOW + 5);
    expect(pds.shelf()!.sales).toHaveLength(1); // 出品者が受け取るまでは残る
    await marketList(env, DID, { pieceRkey: 'p2', price: 5, rkey: 'L2' }, NOW + 20);
    expect(pds.shelf()!.sales).toHaveLength(1);
    await marketReconcile(env, DID, NOW + 30);
    await marketBuy(env, CAROL, { seller: DID, listingId: 'L2', rkey: 'C1' }, NOW + 40);
    expect(pds.shelf()!.sales.map((s) => s.listingId)).toEqual(['L2']);
  });
});
