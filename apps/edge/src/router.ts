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
}

export async function handleRequest(req: Request, _env: Env): Promise<Response> {
  const url = new URL(req.url);

  // CORS preflight。aozoraquest.app と dev.aozoraquest.app からの呼び出しを許可する。
  if (req.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }));
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return cors(json({ ok: true }));
  }

  if (req.method === 'GET' && url.pathname === '/version') {
    return cors(json({
      name: 'aozoraquest-edge',
      phase: 1,
      // CI 時に上書きされる前提。ローカルでは 'dev'。
      commit: globalThis.__COMMIT__ ?? 'dev',
    }));
  }

  if (req.method === 'GET' && url.pathname === '/probe/oauth') {
    const result = await probeOAuthLibrary();
    return cors(json(result, result.ok ? 200 : 503));
  }

  return cors(json({ error: 'not_found', path: url.pathname }, 404));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function cors(res: Response): Response {
  const headers = new Headers(res.headers);
  // MVP: aozoraquest 系 origin のみ許可。プロダクションで厳格化する。
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'authorization, content-type');
  return new Response(res.body, { status: res.status, headers });
}

declare global {
  // eslint-disable-next-line no-var
  var __COMMIT__: string | undefined;
}
