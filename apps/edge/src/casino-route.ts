/**
 * カジノの道 (D-CASINO-001)。router.ts からは 1 行で呼ぶ (party-orders-route と同じ形)。
 * - `POST /api/casino/exchange {power, rkey, token}` / `bonus {rkey, token}` / `prize {prizeId, rkey, token}`
 * - `POST /api/casino/play {game, bet, choice, rkey, token}`
 * - `POST /api/casino/race {rkey, token}`: 賭ける前のレースの顔ぶれ (読むだけ・書かない)
 * 位置は署名トークン (無ければ state)。うん は装備込みでサーバーが出す。乱数は kuda + CSPRNG。
 */
import { LXM } from '@aozoraquest/core';
import { ResolverError, migrateInitState, playerLuk, type ResolverEnv } from './battle-resolver';
import { verifyServiceAuth, ServiceAuthError } from './service-auth';
import { ensureAuthoredWorld, type WorldAuthoringEnv } from './world-authoring';
import { positionAndState } from './story-battle';
import { entropyU32 } from './kuda';
import { casinoBonus, casinoExchange, casinoPlay, casinoPrize, casinoRaceLineup } from './casino';

const PATHS: Record<string, string> = {
  '/api/casino/exchange': LXM.casinoExchange,
  '/api/casino/bonus': LXM.casinoBonus,
  '/api/casino/prize': LXM.casinoPrize,
  '/api/casino/play': LXM.casinoPlay,
  '/api/casino/race': LXM.casinoPlay,
};

type CasinoEnv = ResolverEnv & WorldAuthoringEnv & { WORKER_DID?: string; KUDA_API_KEY?: string };

/** /api/casino/* を受ける。この道でなければ null。 */
export async function handleCasinoRoute(req: Request, url: URL, env: CasinoEnv, now: number, ns: string, respond: (body: unknown, status?: number) => Response, onError: (e: unknown) => Response): Promise<Response | null> {
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
    await ensureAuthoredWorld(env, now); // カジノのマスは world.interiors、表は world.casino
    const { pos } = await positionAndState(env, did, typeof body.token === 'string' ? body.token : undefined, now, ns);
    switch (url.pathname) {
      case '/api/casino/exchange': return respond(await casinoExchange(env, did, { power: body.power, rkey: body.rkey, pos }, now, init));
      case '/api/casino/bonus': return respond(await casinoBonus(env, did, { rkey: body.rkey, pos }, now, init));
      case '/api/casino/prize': return respond(await casinoPrize(env, did, { prizeId: body.prizeId, rkey: body.rkey, pos }, now, init));
      case '/api/casino/race': {
        if (typeof body.rkey !== 'string' || !body.rkey) throw new ResolverError('rkey が不正', 400, 'bad_request');
        return respond({ runners: casinoRaceLineup(pos, body.rkey) });
      }
      default: {
        const luk = await playerLuk(env, did, ns);
        const seed = (await entropyU32({ useKuda: true, apiKey: env.KUDA_API_KEY })).value;
        const choice = body.choice && typeof body.choice === 'object' ? (body.choice as Record<string, unknown>) : undefined;
        return respond(await casinoPlay(env, did, { game: body.game, bet: body.bet, choice, rkey: body.rkey, pos, luk, seed }, now, init));
      }
    }
  } catch (e) {
    return onError(e);
  }
}
