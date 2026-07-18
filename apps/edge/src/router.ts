/**
 * aozoraquest edge Worker のリクエストハンドラ。
 *
 * 現在:
 *   - GET  /healthz: 起動確認
 *   - GET  /version: ビルド情報 (deploy 検証用)
 *   - POST /api/whoami: service auth JWT を検証して呼び出し元 DID を返す (M1 認証基盤)
 *
 * 予定 (docs/21-server-authority): あおぞらワールドのゲーム経済をサーバー権威化する
 *   /api/battle/* /api/xp/* /api/me/state (M2〜)。依頼クエスト集約 (docs/15) も。
 */
import { verifyServiceAuth, ServiceAuthError } from './service-auth';
import { getRecord } from './pds';
import { GAME_STATE_COLLECTION, rkeyForDid, emptyState } from './game-state';

export interface Env {
  ENVIRONMENT?: string;
  /** カンマ区切り。空 or 未設定なら CORS 全許可 (dev 用)。production では必ず設定する */
  ALLOWED_ORIGINS?: string;
  /** この Worker の DID (service auth JWT の aud)。既定 did:web:edge.aozoraquest.app */
  WORKER_DID?: string;
  /** 権威 state を置く app サーバーアカウントの PDS URL と DID (public read 用、非 secret)。 */
  SERVER_PDS_URL?: string;
  SERVER_DID?: string;
}

/** service auth の lexicon method (lxm)。エンドポイントごとに別値。 */
const LXM_WHOAMI = 'app.aozoraquest.whoami';
const LXM_ME_STATE = 'app.aozoraquest.me.state';

const AOZORA_ORIGINS = new Set([
  'https://aozoraquest.app',
  'https://dev.aozoraquest.app',
  // ローカル開発で UI から叩く想定
  'http://localhost:9999',
  'http://127.0.0.1:9999',
]);

function pickOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  if (env.ALLOWED_ORIGINS) {
    const list = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    return list.includes(origin) ? origin : null;
  }
  return AOZORA_ORIGINS.has(origin) ? origin : null;
}

export async function handleRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const allowedOrigin = pickOrigin(req, env);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }), allowedOrigin);
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return cors(json({ ok: true }), allowedOrigin);
  }

  if (req.method === 'GET' && url.pathname === '/version') {
    return cors(json({
      name: 'aozoraquest-edge',
      phase: 1,
      commit: globalThis.__COMMIT__ ?? 'dev',
    }), allowedOrigin);
  }

  // service auth JWT を検証して呼び出し元 DID を返す (M1 認証基盤の疎通確認)。
  if (req.method === 'POST' && url.pathname === '/api/whoami') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    try {
      const { iss } = await verifyServiceAuth(token, { audience, lxm: LXM_WHOAMI });
      return cors(json({ did: iss }), allowedOrigin);
    } catch (e) {
      // fail-closed: 検証失敗は 401 (詳細は漏らしすぎない)
      const msg = e instanceof ServiceAuthError ? e.message : 'verify_failed';
      return cors(json({ error: 'unauthorized', reason: msg }, 401), allowedOrigin);
    }
  }

  // 権威 state (ゲーム経済) の読み取り。自分の DID の分だけ返す (JWT で本人確認)。
  // 読みは public getRecord なので session 不要。書き込みは M3 の battle 系で行う。
  if (req.method === 'GET' && url.pathname === '/api/me/state') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_ME_STATE }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    if (!env.SERVER_PDS_URL || !env.SERVER_DID) return cors(json({ error: 'server_not_configured' }, 503), allowedOrigin);
    const rec = await getRecord(env.SERVER_PDS_URL, env.SERVER_DID, GAME_STATE_COLLECTION, rkeyForDid(did));
    // 未作成なら初期値を返す (実 state 化は初回の書込み = M3 で。移行はそこでクランプ)
    return cors(json({ state: rec?.value ?? emptyState(did, new Date().toISOString()), initialized: rec !== null }), allowedOrigin);
  }

  return cors(json({ error: 'not_found', path: url.pathname }, 404), allowedOrigin);
}

/** Authorization: Bearer <jwt> を取り出す。 */
function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function cors(res: Response, allowedOrigin: string | null): Response {
  const headers = new Headers(res.headers);
  // 許可された origin のみ反射的に返す。Origin ヘッダなし (curl 等) は素通り。
  if (allowedOrigin) {
    headers.set('access-control-allow-origin', allowedOrigin);
    headers.set('vary', 'origin');
  }
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'authorization, content-type');
  return new Response(res.body, { status: res.status, headers });
}

declare global {
  // eslint-disable-next-line no-var
  var __COMMIT__: string | undefined;
}
