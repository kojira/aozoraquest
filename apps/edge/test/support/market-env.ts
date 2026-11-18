/** 街で売る (D-MARKET-001) の edge テストの共通部 (market.test.ts・market-buy.test.ts)。PDS は fetch の差し替え。 */
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { worldOverlay } from '@aozoraquest/core';
import type { Env } from '../../src/router';
import { rkeyForDid, XP_EPOCH, type GameState, type GameStateEnv, type MarketListing } from '../../src/game-state';
import { writeServerTokens } from '../../src/oauth-store';
import type { ShelfListing, TownStock } from '../../src/market-stock';

export const DID = 'did:plc:alice';
export const NOW = 1_700_000_000;
export const DEV_STOCK = 'app.aozoraquest.dev.townStock';
export const PROD_STOCK = 'app.aozoraquest.townStock';
export const towns = worldOverlay().towns;
export const TOWN = towns[0]!;
export const ITEM = 'wp-knife'; // grade1 = どの街にも出せる
export const rk = (t: { x: number; y: number }) => `${t.x}_${t.y}`;

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill), pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
export async function makeEnv(adminNsidEnv: string | null = 'dev'): Promise<GameStateEnv & Env> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: 'did:plc:server', accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 7200, pdsUrl: 'https://pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { SERVER_DID: 'did:plc:server', OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), WORKER_DID: 'did:web:edge.test', OAUTH_TOKENS: kv, ...(adminNsidEnv ? { ADMIN_NSID_ENV: adminNsidEnv } : {}) };
}

/** サーバー PDS のふり。key = `collection/rkey`。failPut が true を返す put は 500 にする (途中で止まった書き込み)。 */
export function serverPds(seed: Record<string, unknown> = {}) {
  const store = new Map<string, { value: unknown; cid: string }>(Object.entries(seed).map(([k, v]) => [k, { value: v, cid: `seed-${k}` }]));
  const touched = new Set<string>();
  let n = 0;
  let failPut: (collection: string) => boolean = () => false;
  let beforePut: (collection: string) => Promise<void> = async () => {};
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
      await beforePut(b.collection);
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
    /** put の直前に待つ (同時に書く 2 人を作る)。 */
    setBeforePut: (f: (collection: string) => Promise<void>) => { beforePut = f; },
    gs: (did = DID, col = 'app.aozoraquest.dev.gameState') => store.get(`${col}/${rkeyForDid(did)}`)!.value as GameState,
    shelf: (t: { x: number; y: number } = TOWN, col = DEV_STOCK) => store.get(`${col}/${rk(t)}`)?.value as TownStock | undefined,
  };
}

export const piece = (i: number, itemId = ITEM, level = 0) => ({ rkey: `p${i}`, itemId, level });
export const GS = (over: Partial<GameState> = {}): GameState => ({ did: DID, activeQuests: [], power: 50, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: TOWN.x, y: TOWN.y, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', pieces: [piece(1), piece(2), piece(3)], ...over });
export const seedGs = (s: GameState, did = DID) => ({ [`app.aozoraquest.dev.gameState/${rkeyForDid(did)}`]: s });
export const listingIn = (t: { x: number; y: number }, id: string): MarketListing => ({ id, town: { x: t.x, y: t.y }, pieceRkey: `lp-${id}`, itemId: ITEM, level: 0, price: 5, listedAt: NOW - 60 });
export const onShelfAs = (l: MarketListing, seller = DID): ShelfListing => ({ id: l.id, seller, itemId: l.itemId, level: l.level, price: l.price, listedAt: l.listedAt });

