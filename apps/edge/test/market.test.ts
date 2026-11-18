/**
 * D-MARKET-001 PR2: 出品・取り下げ・照合 (market.ts) と街の棚 townStock (market-stock.ts)。
 * PDS は fetch の差し替え。collection と rkey ごとに 1 件を持ち、CAS (swapRecord) も本物と同じ形で見る。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { EQUIPMENT_BY_ID, LXM, MARKET_LIMITS, townShopStock, worldOverlay } from '@aozoraquest/core';
import { marketCancel, marketList, marketReconcile, listOnShelf } from '../src/market';
import { emptyTownStock, MARKET_RKEY_MAX, townStockCollection, type ShelfListing, type TownStock } from '../src/market-stock';
import { shopCraft, MAX_OWNED_PIECES } from '../src/shop';
import { handleRequest, type Env } from '../src/router';
import { rkeyForDid, XP_EPOCH, type GameState, type GameStateEnv, type MarketListing } from '../src/game-state';
import { writeServerTokens } from '../src/oauth-store';

const DID = 'did:plc:alice';
const NOW = 1_700_000_000;
const DEV_STOCK = 'app.aozoraquest.dev.townStock';
const PROD_STOCK = 'app.aozoraquest.townStock';
const towns = worldOverlay().towns;
const TOWN = towns[0]!;
const ITEM = 'wp-knife'; // grade1 = どの街にも出せる
const rk = (t: { x: number; y: number }) => `${t.x}_${t.y}`;

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill), pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
async function makeEnv(adminNsidEnv: string | null = 'dev'): Promise<GameStateEnv & Env> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: 'did:plc:server', accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 7200, pdsUrl: 'https://pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { SERVER_DID: 'did:plc:server', OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), WORKER_DID: 'did:web:edge.test', OAUTH_TOKENS: kv, ...(adminNsidEnv ? { ADMIN_NSID_ENV: adminNsidEnv } : {}) };
}

/** サーバー PDS のふり。key = `collection/rkey`。failPut が true を返す put は 500 にする (途中で止まった書き込み)。 */
function serverPds(seed: Record<string, unknown> = {}) {
  const store = new Map<string, { value: unknown; cid: string }>(Object.entries(seed).map(([k, v]) => [k, { value: v, cid: `seed-${k}` }]));
  const touched = new Set<string>();
  let n = 0;
  let failPut: (collection: string) => boolean = () => false;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('com.atproto.repo.getRecord')) {
      const q = new URL(url).searchParams;
      touched.add(q.get('collection')!);
      const rec = store.get(`${q.get('collection')}/${q.get('rkey')}`);
      return rec ? json(200, { uri: 'at://x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    if (url.includes('com.atproto.repo.putRecord')) {
      const b = JSON.parse(init.body as string) as { collection: string; rkey: string; record: unknown; swapRecord?: string | null };
      touched.add(b.collection);
      if (failPut(b.collection)) return json(500, { error: 'InternalServerError' });
      const k = `${b.collection}/${b.rkey}`, cur = store.get(k);
      if ((b.swapRecord === null && cur) || (typeof b.swapRecord === 'string' && cur?.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      store.set(k, { value: b.record, cid: `c${++n}` });
      return json(200, { uri: 'at://x', cid: `c${n}` });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
  return {
    fn, store, touched,
    setFailPut: (f: (collection: string) => boolean) => { failPut = f; },
    gs: (col = 'app.aozoraquest.dev.gameState') => store.get(`${col}/${rkeyForDid(DID)}`)!.value as GameState,
    shelf: (t: { x: number; y: number } = TOWN, col = DEV_STOCK) => store.get(`${col}/${rk(t)}`)?.value as TownStock | undefined,
  };
}

const piece = (i: number, itemId = ITEM, level = 0) => ({ rkey: `p${i}`, itemId, level });
const GS = (over: Partial<GameState> = {}): GameState => ({ did: DID, activeQuests: [], power: 50, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: TOWN.x, y: TOWN.y, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', pieces: [piece(1), piece(2), piece(3)], ...over });
const seedGs = (s: GameState) => ({ [`app.aozoraquest.dev.gameState/${rkeyForDid(DID)}`]: s });
const listingIn = (t: { x: number; y: number }, id: string): MarketListing => ({ id, town: { x: t.x, y: t.y }, pieceRkey: `lp-${id}`, itemId: ITEM, level: 0, price: 5, listedAt: NOW - 60 });
const onShelfAs = (l: MarketListing, seller = DID): ShelfListing => ({ id: l.id, seller, itemId: l.itemId, level: l.level, price: l.price, listedAt: l.listedAt });

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
