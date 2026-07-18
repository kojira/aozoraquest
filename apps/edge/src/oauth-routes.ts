/**
 * OAuth write 認証のルートハンドラ — docs/21 §12。router.ts から呼ぶ。
 *
 *   GET  /client-metadata.json  confidential client メタデータ (公開)
 *   POST /api/oauth/start       管理者 (service auth JWT + ADMIN_DIDS) が OAuth を開始 → authorizeUrl
 *   GET  /oauth/callback        認可サーバーからの code を token に交換し KV に格納 (state で CSRF 検証)
 *
 * 初回 bootstrap 用。以後の refresh は cron。依存 (verify/fetch/now/kv) は注入可能にしテストする。
 */
import { verifyServiceAuth, resolveDidDocument, type DidDocument } from './service-auth';
import { loadOAuthConfig, buildClientMetadata, isEdgeAdmin, OAuthConfigError, type OAuthEnv } from './oauth-config';
import { discoverForDid } from './oauth-metadata';
import { buildAuthorizeUrl, exchangeCode } from './oauth-client';
import { putPendingAuth, takePendingAuth, writeServerTokens } from './oauth-store';

export const LXM_OAUTH_START = 'app.aozoraquest.oauth.start';

/** router.ts の Env のうち OAuth ルートが使う部分 + KV。 */
export interface OAuthRoutesEnv extends OAuthEnv {
  OAUTH_TOKENS?: KVNamespace;
}

interface Deps {
  now: number;
  fetchImpl?: typeof fetch;
  /** service auth 検証 (テストで差し替え)。 */
  verify?: (token: string, opts: { audience?: string; lxm?: string; now: number; resolveDid?: (d: string) => Promise<DidDocument> }) => Promise<{ iss: string }>;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const html = (body: string, status = 200) => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">${body}`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const bearer = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';

/** GET /client-metadata.json */
export function handleClientMetadata(env: OAuthRoutesEnv): Response {
  try {
    return json(buildClientMetadata(loadOAuthConfig(env)));
  } catch (e) {
    if (e instanceof OAuthConfigError) return json({ error: 'oauth_not_configured', message: e.message }, 503);
    throw e;
  }
}

/** POST /api/oauth/start — 管理者のみ。authorizeUrl を返す。 */
export async function handleOAuthStart(req: Request, env: OAuthRoutesEnv, deps: Deps): Promise<Response> {
  if (!env.OAUTH_TOKENS) return json({ error: 'oauth_not_configured', message: 'KV 未 binding' }, 503);
  let cfg;
  try {
    cfg = loadOAuthConfig(env);
  } catch (e) {
    if (e instanceof OAuthConfigError) return json({ error: 'oauth_not_configured', message: e.message }, 503);
    throw e;
  }
  // 管理者ゲート: service auth JWT (aud=この Worker, lxm=oauth.start) → iss が ADMIN_DIDS に含まれること。
  const audience = env.WORKER_DID;
  if (!audience) return json({ error: 'oauth_not_configured', message: 'WORKER_DID 未設定' }, 503);
  const token = bearer(req);
  if (!token) return json({ error: 'missing_token' }, 401);
  const verify = deps.verify ?? verifyServiceAuth;
  let iss: string;
  try {
    ({ iss } = await verify(token, { audience, lxm: LXM_OAUTH_START, now: deps.now, resolveDid: (d) => resolveDidDocument(d, deps.fetchImpl) }));
  } catch {
    return json({ error: 'invalid_token' }, 401);
  }
  if (!isEdgeAdmin(env, iss)) return json({ error: 'forbidden' }, 403);

  const { pdsUrl, authServer } = await discoverForDid(cfg.serverDid, deps.fetchImpl);
  const { url, state, verifier } = await buildAuthorizeUrl({ ...cfg, now: deps.now, fetchImpl: deps.fetchImpl }, authServer, { loginHint: cfg.serverDid });
  await putPendingAuth(env.OAUTH_TOKENS, state, { verifier, authServer, pdsUrl, createdAt: deps.now });
  return json({ authorizeUrl: url });
}

/** GET /oauth/callback — 認可サーバーからのリダイレクト。code→token 交換し KV 格納。 */
export async function handleOAuthCallback(req: Request, env: OAuthRoutesEnv, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const err = url.searchParams.get('error');
  if (err) return html(`<h1>連携に失敗しました</h1><p>${err}: ${url.searchParams.get('error_description') ?? ''}</p>`, 400);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return html('<h1>不正なコールバック</h1><p>code / state がありません</p>', 400);
  if (!env.OAUTH_TOKENS) return html('<h1>設定エラー</h1><p>KV 未 binding</p>', 503);

  const pending = await takePendingAuth(env.OAUTH_TOKENS, state);
  if (!pending) return html('<h1>セッション切れ</h1><p>state が無効か期限切れです。もう一度お試しください</p>', 400);

  let cfg;
  try {
    cfg = loadOAuthConfig(env);
  } catch (e) {
    if (e instanceof OAuthConfigError) return html('<h1>設定エラー</h1>', 503);
    throw e;
  }
  const tokens = await exchangeCode({ ...cfg, now: deps.now, fetchImpl: deps.fetchImpl }, pending.authServer, code, pending.verifier, pending.pdsUrl, cfg.serverDid);
  await writeServerTokens(env.OAUTH_TOKENS, tokens);
  return html(`<h1>連携できました ✅</h1><p>サーバーアカウント (${tokens.did}) の書き込み認証を保存しました。このタブは閉じて構いません。</p>`);
}
