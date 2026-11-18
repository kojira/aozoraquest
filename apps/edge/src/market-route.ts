/**
 * 装備を街で売る (D-MARKET-001) の道。router.ts からは 1 行で呼ぶ (casino-route と同じ形)。
 * - `GET /api/market/town?x&y`: 街の棚を安い順に (認証なしで読むだけ)
 * - `POST /api/market/list {pieceRkey, price, rkey, token}`: 出品する (値段は出品者が決める。1 以上の整数)
 * - `POST /api/market/cancel {listingId}`: 取り下げる (持ち物に戻る)
 * - `POST /api/market/mine {}`: 店を開いたときの照合。棚に無い自分の品を持ち物に戻し、出品中の一覧を返す
 * 位置は署名トークン (無ければ state)。
 */
import { LXM, townAt } from '@aozoraquest/core';
import { verifyServiceAuth, ServiceAuthError } from './service-auth';
import { ensureAuthoredWorld, type WorldAuthoringEnv } from './world-authoring';
import { migrateInitState, type ResolverEnv } from './battle-resolver';
import { verifyPosition } from './world-token';
import { ShopError } from './shop';
import { marketCancel, marketList, marketReconcile, shelfCheapestFirst } from './market';
import { readTownStock } from './market-stock';

const PATHS: Record<string, string> = {
  '/api/market/list': LXM.marketList,
  '/api/market/cancel': LXM.marketCancel,
  '/api/market/mine': LXM.marketMine,
};

type MarketEnv = ResolverEnv & WorldAuthoringEnv & { WORKER_DID?: string };

/** /api/market/* を受ける。この道でなければ null。 */
export async function handleMarketRoute(req: Request, url: URL, env: MarketEnv, now: number, ns: string, respond: (body: unknown, status?: number) => Response, onError: (e: unknown) => Response): Promise<Response | null> {
  const fail = (e: unknown) => (e instanceof ShopError ? respond({ error: e.code ?? 'shop_error', message: e.message }, e.status) : onError(e));
  if (req.method === 'GET' && url.pathname === '/api/market/town') {
    const x = Number(url.searchParams.get('x')), y = Number(url.searchParams.get('y'));
    if (!Number.isInteger(x) || !Number.isInteger(y)) return respond({ error: 'bad_request' }, 400);
    try {
      await ensureAuthoredWorld(env, now);
      const town = townAt(x, y);
      if (!town) return respond({ error: 'not_a_town' }, 404);
      return respond({ town: { x: town.x, y: town.y }, listings: shelfCheapestFirst((await readTownStock(env, town))?.stock ?? null) });
    } catch (e) {
      return fail(e);
    }
  }
  const lxm = req.method === 'POST' ? PATHS[url.pathname] : undefined;
  if (!lxm) return null;
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return respond({ error: 'missing_token' }, 401);
  let did: string;
  try {
    ({ iss: did } = await verifyServiceAuth(token, { audience: env.WORKER_DID ?? 'did:web:edge.aozoraquest.app', lxm }));
  } catch (e) {
    return respond({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401);
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const init = (d: string, iso: string) => migrateInitState(d, iso, ns);
  try {
    await ensureAuthoredWorld(env, now); // 店のマスは world.interiors、装備の定義は world.items
    if (url.pathname === '/api/market/list') {
      if (typeof body.pieceRkey !== 'string' || typeof body.rkey !== 'string') return respond({ error: 'bad_request' }, 400);
      const pos = positionOf(env, body.token, did, now);
      return respond(await marketList(env, did, { pieceRkey: body.pieceRkey, price: body.price, rkey: body.rkey, ...(pos ? { pos } : {}) }, now, init));
    }
    if (url.pathname === '/api/market/cancel') {
      if (typeof body.listingId !== 'string') return respond({ error: 'bad_request' }, 400);
      return respond(await marketCancel(env, did, { listingId: body.listingId }, now, init));
    }
    return respond(await marketReconcile(env, did, now, init));
  } catch (e) {
    return fail(e);
  }
}

/** 署名トークンの位置 (無い・無効なら undefined = state の位置。router の positionFrom と同じ)。 */
function positionOf(env: MarketEnv, token: unknown, did: string, now: number): { x: number; y: number; mapId?: string } | undefined {
  if (typeof token !== 'string' || !token) return undefined;
  try {
    const c = verifyPosition(env, token, did, now);
    return { x: c.x, y: c.y, ...(c.mapId ? { mapId: c.mapId } : {}) };
  } catch {
    return undefined;
  }
}
