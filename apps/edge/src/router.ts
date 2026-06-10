/**
 * 依頼クエスト集約 Worker のリクエストハンドラ。
 *
 * Phase 1 (現在):
 *   - GET /healthz: 起動確認
 *   - GET /version: ビルド情報 (= deploy 検証用)
 *   - GET /probe/oauth: @atproto/oauth-client-node が Workers 上で
 *     import 解決できるかの PoC エンドポイント (Phase 1 着手時の検証用)
 *
 * Phase 1 後半で追加予定:
 *   - POST /index/quest: クエスト発行を index に追加
 *   - POST /index/application: 応募を index に追加
 *
 * docs/15-user-quest.md §集約インフラ を参照。
 */
import { probeOAuthLibrary } from './oauth-probe';

export interface Env {
  ENVIRONMENT?: string;
  /** カンマ区切り。空 or 未設定なら CORS 全許可 (dev 用)。production では必ず設定する */
  ALLOWED_ORIGINS?: string;
  /** "1" なら /probe/oauth を有効化。dev 検証以外では disable する */
  ENABLE_OAUTH_PROBE?: string;
}

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

  if (req.method === 'GET' && url.pathname === '/probe/oauth') {
    // production の Worker で誰でも叩けると cold start で重い import が走る。
    // 明示的に env で enable した場合のみ許可。
    if (env.ENABLE_OAUTH_PROBE !== '1') {
      return cors(json({ error: 'probe_disabled' }, 404), allowedOrigin);
    }
    const result = await probeOAuthLibrary();
    return cors(json(result, result.ok ? 200 : 503), allowedOrigin);
  }

  return cors(json({ error: 'not_found', path: url.pathname }, 404), allowedOrigin);
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
