/**
 * D-MARKET-001 PR2: 出品・取り下げ・照合 (market.ts) と街の棚 townStock (market-stock.ts)。
 * PDS は fetch の差し替え。collection と rkey ごとに 1 件を持ち、CAS (swapRecord) も本物と同じ形で見る。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { EQUIPMENT_BY_ID, LXM, MARKET_LIMITS, townShopStock } from '@aozoraquest/core';
import { marketCancel, marketList, marketReconcile, listOnShelf } from '../src/market';
import { emptyTownStock, MARKET_RKEY_MAX, townStockCollection, type ShelfListing, type TownStock } from '../src/market-stock';
import { DEV_STOCK, DID, GS, ITEM, listingIn, makeEnv, NOW, onShelfAs, piece, PROD_STOCK, rk, seedGs, serverPds, TOWN, towns } from './support/market-env';
import { shopCraft, MAX_OWNED_PIECES } from '../src/shop';
import { handleRequest } from '../src/router';

describe('D-MARKET-001 出品 (marketList)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('出品すると pieces が 1 つ減り、listings と街の棚が 1 つ増える (値段は出品者が決めた値)', async () => {
    const env = await makeEnv();
    const pds = serverPds(seedGs(GS()));
    globalThis.fetch = pds.fn;
    const r = await marketList(env, DID, { pieceRkey: 'p2', price: 37, rkey: 'L1' }, NOW);
    expect(r.onShelf).toBe(true);
    expect(pds.gs().pieces!.map((p) => p.rkey)).toEqual(['p1', 'p3']);
    expect(pds.gs().listings).toEqual([{ id: 'L1', town: { x: TOWN.x, y: TOWN.y }, pieceRkey: 'p2', itemId: ITEM, level: 0, price: 37, listedAt: NOW }]);
    expect(pds.shelf()!.listings).toEqual([{ id: 'L1', seller: DID, itemId: ITEM, level: 0, price: 37, listedAt: NOW }]);
    // 1 以上の整数でない値段は断る
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 0, rkey: 'L2' }, NOW)).rejects.toMatchObject({ code: 'bad_price' });
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 2.5, rkey: 'L3' }, NOW)).rejects.toMatchObject({ code: 'bad_price' });
  });

  it(`${MARKET_LIMITS.perUser + 1} 品目と、同じ街の ${MARKET_LIMITS.perUserPerTown + 1} 品目を断る`, async () => {
    const env = await makeEnv();
    const others = towns.filter((t) => t.x !== TOWN.x || t.y !== TOWN.y);
    // 全体の上限: ほかの街に 2 品ずつ、ちょうど上限まで出している
    const full = Array.from({ length: MARKET_LIMITS.perUser }, (_, i) => listingIn(others[Math.floor(i / 2)]!, `F${i}`));
    let pds = serverPds(seedGs(GS({ listings: full })));
    globalThis.fetch = pds.fn;
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 5, rkey: 'X1' }, NOW)).rejects.toMatchObject({ code: 'limit_user' });
    expect(pds.gs().pieces).toHaveLength(3);
    // 同じ街の上限
    pds = serverPds(seedGs(GS({ listings: [listingIn(TOWN, 'T1'), listingIn(TOWN, 'T2')] })));
    globalThis.fetch = pds.fn;
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 5, rkey: 'X2' }, NOW)).rejects.toMatchObject({ code: 'limit_town' });
    expect(pds.gs().listings).toHaveLength(2);
  });

  it('主人公が装備中・仲間が装備中の品は断る', async () => {
    const env = await makeEnv();
    let pds = serverPds(seedGs(GS({ pieces: [piece(1)], gearSel: { weapon: { id: ITEM, level: 0 } } })));
    globalThis.fetch = pds.fn;
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 5, rkey: 'E1' }, NOW)).rejects.toMatchObject({ code: 'equipped' });
    pds = serverPds(seedGs(GS({ pieces: [piece(1)], party: { ids: ['a1'], gear: { a1: { weapon: { id: ITEM, level: 0 } } } } })));
    globalThis.fetch = pds.fn;
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 5, rkey: 'E2' }, NOW)).rejects.toMatchObject({ code: 'equipped' });
    expect(pds.gs().pieces).toHaveLength(1);
    // 同じ品をもう 1 つ持っていれば、着ていないほうは出せる
    pds = serverPds(seedGs(GS({ pieces: [piece(1), piece(2)], gearSel: { weapon: { id: ITEM, level: 0 } } })));
    globalThis.fetch = pds.fn;
    expect((await marketList(env, DID, { pieceRkey: 'p2', price: 5, rkey: 'E3' }, NOW)).onShelf).toBe(true);
  });

  it('カジノの景品とその街の段階を超える品は断る', async () => {
    const env = await makeEnv();
    const pds = serverPds(seedGs(GS({ pieces: [piece(1, 'wp-star-sword')] })));
    globalThis.fetch = pds.fn;
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 5, rkey: 'C1' }, NOW)).rejects.toMatchObject({ code: 'casino' });
  });

  it('同じ rkey を 2 回送っても 1 回分だけ', async () => {
    const env = await makeEnv();
    const pds = serverPds(seedGs(GS()));
    globalThis.fetch = pds.fn;
    await marketList(env, DID, { pieceRkey: 'p1', price: 9, rkey: 'D1' }, NOW);
    const again = await marketList(env, DID, { pieceRkey: 'p1', price: 9, rkey: 'D1' }, NOW + 1);
    expect(again.duplicate).toBe(true);
    expect(pds.gs().listings).toHaveLength(1);
    expect(pds.gs().pieces).toHaveLength(2);
    expect(pds.shelf()!.listings).toHaveLength(1);
  });

  it('棚への書き込みが 5 分を過ぎて届いた出品は棚に載らず、10 分を過ぎた照合で持ち物に戻る', async () => {
    const env = await makeEnv();
    const pds = serverPds(seedGs(GS()));
    globalThis.fetch = pds.fn;
    pds.setFailPut((c) => c === DEV_STOCK); // 手順 1 のあとで止まった
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 9, rkey: 'S1' }, NOW)).rejects.toThrow();
    pds.setFailPut(() => false);
    const listing = pds.gs().listings![0]!;
    expect(listing.id).toBe('S1');
    expect(await listOnShelf(env, DID, listing, NOW + 5 * 60 + 1)).toBe(false); // 遅れて届いた書き込み
    expect(pds.shelf()?.listings ?? []).toHaveLength(0);
    expect((await marketReconcile(env, DID, NOW + 9 * 60)).returned).toHaveLength(0); // まだ届くかもしれない間は戻さない
    const r = await marketReconcile(env, DID, NOW + 10 * 60 + 1);
    expect(r.returned.map((l) => l.id)).toEqual(['S1']);
    expect(pds.gs().listings).toEqual([]);
    expect(pds.gs().pieces!.map((p) => p.rkey).sort()).toEqual(['p1', 'p2', 'p3']);
    // 2 回照合しても 2 つには増えない
    await marketReconcile(env, DID, NOW + 11 * 60);
    expect(pds.gs().pieces).toHaveLength(3);
  });

  it('街の棚が満杯 (200 品) なら断り、品は持ち物に残る', async () => {
    const env = await makeEnv();
    const shelf: TownStock = { ...emptyTownStock(TOWN, ''), listings: Array.from({ length: MARKET_LIMITS.perTown }, (_, i) => onShelfAs(listingIn(TOWN, `o${i}`), `did:plc:other${i}`)) };
    const pds = serverPds({ ...seedGs(GS()), [`${DEV_STOCK}/${rk(TOWN)}`]: shelf });
    globalThis.fetch = pds.fn;
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 9, rkey: 'B1' }, NOW)).rejects.toMatchObject({ code: 'shelf_full' });
    expect(pds.gs().pieces).toHaveLength(3);
    expect(pds.gs().listings).toEqual([]);
    expect(pds.shelf()!.listings).toHaveLength(MARKET_LIMITS.perTown);
  });

  it('もちもの + 出品中 で上限を数える (出品中の品が戻れなくならない)', async () => {
    const env = await makeEnv();
    const pieces = Array.from({ length: MAX_OWNED_PIECES - 1 }, (_, i) => piece(i));
    const stock = townShopStock(TOWN, 0);
    const pds = serverPds(seedGs(GS({ pieces, listings: [listingIn(towns[1]!, 'H1')], power: 999, materials: { [stock.materialId]: 99 } })));
    globalThis.fetch = pds.fn;
    await expect(shopCraft(env, DID, { itemId: stock.equipment[0]!, rkey: 'cc1', luk: 0 }, NOW)).rejects.toMatchObject({ code: 'pieces_full' });
  });
});

describe('D-MARKET-001 取り下げ (marketCancel)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('取り下げると棚から消え、すぐ持ち物に戻る。遅れて届いた書き込みでも棚に戻らない', async () => {
    const env = await makeEnv();
    const pds = serverPds(seedGs(GS()));
    globalThis.fetch = pds.fn;
    const { listing } = await marketList(env, DID, { pieceRkey: 'p3', price: 12, rkey: 'K1' }, NOW);
    const r = await marketCancel(env, DID, { listingId: 'K1' }, NOW + 30);
    expect(r.returned.map((l) => l.id)).toEqual(['K1']);
    expect(pds.shelf()!.listings).toEqual([]);
    expect(pds.gs().pieces!.map((p) => p.rkey).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(await listOnShelf(env, DID, listing!, NOW + 31)).toBe(false);
    expect(pds.shelf()!.listings).toEqual([]);
  });

  it('もう売れた品は取り下げられない', async () => {
    const env = await makeEnv();
    const l = listingIn(TOWN, 'Z1');
    const shelf: TownStock = { ...emptyTownStock(TOWN, ''), sales: [{ listingId: 'Z1', seller: DID, buyer: 'did:plc:bob', op: 'o1', price: 5, itemId: ITEM, level: 0, at: NOW }] };
    const pds = serverPds({ ...seedGs(GS({ listings: [l] })), [`${DEV_STOCK}/${rk(TOWN)}`]: shelf });
    globalThis.fetch = pds.fn;
    await expect(marketCancel(env, DID, { listingId: 'Z1' }, NOW)).rejects.toMatchObject({ code: 'already_sold' });
    expect(pds.gs().listings).toHaveLength(1);
  });
});

describe('D-MARKET-001 街の棚の道 (router)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('GET /api/market/town は認証なしで、棚を安い順に返す', async () => {
    const env = await makeEnv();
    const a = { ...onShelfAs(listingIn(TOWN, 'a'), 'did:plc:x'), price: 30 }, b = { ...onShelfAs(listingIn(TOWN, 'b'), 'did:plc:y'), price: 4 };
    const pds = serverPds({ [`${DEV_STOCK}/${rk(TOWN)}`]: { ...emptyTownStock(TOWN, ''), listings: [a, b] } });
    globalThis.fetch = pds.fn;
    const res = await handleRequest(new Request(`https://edge.test/api/market/town?x=${TOWN.x}&y=${TOWN.y}`), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: ShelfListing[] };
    expect(body.listings.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('service auth の無い POST は 401', async () => {
    const env = await makeEnv();
    globalThis.fetch = serverPds().fn;
    const res = await handleRequest(new Request('https://edge.test/api/market/list', { method: 'POST', body: '{}' }), env);
    expect(res.status).toBe(401);
    expect(LXM.marketList).toBe('app.aozoraquest.market.list');
  });
});

describe('D-ENV-002: townStock は Worker env で dev と本番を分ける', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('dev エッジは app.aozoraquest.dev.townStock だけを読み書きし、本番の townStock には触れない', async () => {
    const env = await makeEnv('dev');
    expect(townStockCollection(env)).toBe(DEV_STOCK);
    const prodShelf = { ...emptyTownStock(TOWN, ''), listings: [onShelfAs(listingIn(TOWN, 'prod'), 'did:plc:prod')] };
    const pds = serverPds({ ...seedGs(GS()), [`${PROD_STOCK}/${rk(TOWN)}`]: prodShelf });
    globalThis.fetch = pds.fn;
    await marketList(env, DID, { pieceRkey: 'p1', price: 5, rkey: 'V1' }, NOW);
    await marketCancel(env, DID, { listingId: 'V1' }, NOW + 1);
    const res = await handleRequest(new Request(`https://edge.test/api/market/town?x=${TOWN.x}&y=${TOWN.y}`, { headers: { origin: 'https://aozoraquest.app' } }), env);
    expect(((await res.json()) as { listings: ShelfListing[] }).listings.map((l) => l.id)).not.toContain('prod');
    expect(pds.touched.has(DEV_STOCK)).toBe(true);
    expect(pds.touched.has(PROD_STOCK)).toBe(false);
    expect(pds.store.get(`${PROD_STOCK}/${rk(TOWN)}`)).toEqual({ value: prodShelf, cid: `seed-${PROD_STOCK}/${rk(TOWN)}` });
  });

  it('本番エッジ (ADMIN_NSID_ENV 未設定) は app.aozoraquest.townStock', async () => {
    expect(townStockCollection(await makeEnv(null))).toBe(PROD_STOCK);
  });
});

describe('D-MARKET-001 townStock の大きさ', () => {
  it('棚 200 品 + 売上 200 件 + 取り下げの印 200 件 (いちばん長い値) でも 120KB 未満', () => {
    const did = `did:plc:${'z'.repeat(24)}`, id = 'r'.repeat(MARKET_RKEY_MAX);
    const longest = Object.values(EQUIPMENT_BY_ID).reduce((a, b) => (b.id.length > a.length ? b.id : a), '');
    const shelf: TownStock = {
      version: 1, town: { x: 255, y: 255 }, updatedAt: new Date(NOW * 1000).toISOString(),
      listings: Array.from({ length: MARKET_LIMITS.perTown }, () => ({ id, seller: did, itemId: longest, level: -1, price: Number.MAX_SAFE_INTEGER, listedAt: NOW })),
      sales: Array.from({ length: MARKET_LIMITS.perTown }, () => ({ listingId: id, seller: did, buyer: did, op: id, price: Number.MAX_SAFE_INTEGER, itemId: longest, level: -1, at: NOW })),
      closed: Array.from({ length: MARKET_LIMITS.perTown }, () => ({ id, seller: did, at: NOW })),
    };
    const bytes = new TextEncoder().encode(JSON.stringify({ $type: DEV_STOCK, ...shelf })).length;
    expect(bytes).toBeLessThan(120_000);
  });

  it(`rkey は ${MARKET_RKEY_MAX} 文字まで`, async () => {
    const env = await makeEnv();
    globalThis.fetch = serverPds(seedGs(GS())).fn;
    await expect(marketList(env, DID, { pieceRkey: 'p1', price: 5, rkey: 'r'.repeat(MARKET_RKEY_MAX + 1) }, NOW)).rejects.toMatchObject({ code: 'bad_rkey' });
  });
});
