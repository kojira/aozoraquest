/**
 * 戦闘の読み直し (#1006)。`GET /api/battle/current` → `{ battle: { battleId, turn, state } | null }`。
 *
 * スマホでブラウザを裏に回すと、ターンの答えが画面に届かないままサーバーではターンが進む。画面は古い
 * 番号で送り続け、409 (ターン不一致) から抜けられなかった。画面はここでサーバーのいまの番号と state を
 * 読み、そこから続ける。**読むだけ** — コマンドは片づけず、ガードも書かない (やり直し不可はそのまま)。
 * state は stripState で seed などを落とす (先読み不可)。戦闘が無い (決着ずみ・置き換え) なら null。
 * router.ts からは 1 行で呼ぶ。
 */
import { LXM, type BattleState } from '@aozoraquest/core';
import { readGuard } from './battle-guard';
import { stripState, type SealedMeta } from './battle-encounter';
import { type ResolverEnv } from './battle-resolver';
import { verifyServiceAuth, ServiceAuthError } from './service-auth';

export interface BattleCurrent {
  battle: { battleId: string; turn: number; state: ReturnType<typeof stripState> } | null;
}

export async function handleBattleCurrent(env: ResolverEnv, did: string): Promise<BattleCurrent> {
  const g = await readGuard<SealedMeta, BattleState>(env, did);
  if (!g) return { battle: null };
  return { battle: { battleId: g.guard.battleId, turn: g.guard.turn, state: stripState(g.guard.state) } };
}

/** `GET /api/battle/current` を受ける。この道でなければ null (router は次へ進む)。 */
export async function handleBattleCurrentRoute(req: Request, url: URL, env: ResolverEnv & { WORKER_DID?: string }, respond: (body: unknown, status?: number) => Response, onError: (e: unknown) => Response): Promise<Response | null> {
  if (req.method !== 'GET' || url.pathname !== '/api/battle/current') return null;
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return respond({ error: 'missing_token' }, 401);
  let did: string;
  try {
    ({ iss: did } = await verifyServiceAuth(token, { audience: env.WORKER_DID ?? 'did:web:edge.aozoraquest.app', lxm: LXM.battleCurrent }));
  } catch (e) {
    return respond({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401);
  }
  try {
    return respond(await handleBattleCurrent(env, did));
  } catch (e) {
    return onError(e);
  }
}
