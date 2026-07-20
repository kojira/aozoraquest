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
import { putPendingAuth, takePendingAuth, writeServerTokens, readServerTokens } from './oauth-store';

export const LXM_OAUTH_START = 'app.aozoraquest.oauth.start';
export const LXM_OAUTH_STATUS = 'app.aozoraquest.oauth.status';

/** router.ts の Env のうち OAuth ルートが使う部分 + KV。 */
export interface OAuthRoutesEnv extends OAuthEnv {
  OAUTH_TOKENS?: KVNamespace;
  /** 連携完了後の戻り先 origin の許可リスト (open-redirect 防止)。 */
  ALLOWED_ORIGINS?: string;
}

/** 連携完了後の戻り先 URL を検証する。origin が ALLOWED_ORIGINS に含まれる http(s) URL のみ許可
 *  (open-redirect 防止)。不正/未指定は undefined。export はテスト用。 */
export function validateReturnTo(raw: unknown, allowed?: string): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
  const list = (allowed ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(u.origin) ? u.toString() : undefined;
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

  // 連携完了後の戻り先 (web アプリの設定画面等)。origin を ALLOWED_ORIGINS で検証 (open-redirect 防止)。
  const reqBody = (await req.json().catch(() => ({}))) as { returnTo?: unknown };
  const returnTo = validateReturnTo(reqBody.returnTo, env.ALLOWED_ORIGINS);

  // discovery / PAR は失敗しうる (認可サーバーが client-metadata を弾く等)。**catch して JSON で返す**
  // — 未処理例外だと 500 が CORS ヘッダ無しで返り、ブラウザ側が「Load failed」になり原因が見えない。
  try {
    const { pdsUrl, authServer } = await discoverForDid(cfg.serverDid, deps.fetchImpl);
    const { url, state, verifier } = await buildAuthorizeUrl({ ...cfg, now: deps.now, fetchImpl: deps.fetchImpl }, authServer, { loginHint: cfg.serverDid });
    await putPendingAuth(env.OAUTH_TOKENS, state, { verifier, authServer, pdsUrl, createdAt: deps.now, ...(returnTo ? { returnTo } : {}) });
    return json({ authorizeUrl: url });
  } catch (e) {
    return json({ error: 'oauth_start_failed', message: e instanceof Error ? e.message : String(e) }, 502);
  }
}

/** GET /api/oauth/status — 管理者のみ。サーバーアカウント連携の状態を返す (トークン本体は返さない)。 */
export async function handleOAuthStatus(req: Request, env: OAuthRoutesEnv, deps: Deps): Promise<Response> {
  if (!env.OAUTH_TOKENS) return json({ error: 'oauth_not_configured', message: 'KV 未 binding' }, 503);
  const audience = env.WORKER_DID;
  if (!audience) return json({ error: 'oauth_not_configured', message: 'WORKER_DID 未設定' }, 503);
  const token = bearer(req);
  if (!token) return json({ error: 'missing_token' }, 401);
  const verify = deps.verify ?? verifyServiceAuth;
  let iss: string;
  try {
    ({ iss } = await verify(token, { audience, lxm: LXM_OAUTH_STATUS, now: deps.now, resolveDid: (d) => resolveDidDocument(d, deps.fetchImpl) }));
  } catch {
    return json({ error: 'invalid_token' }, 401);
  }
  if (!isEdgeAdmin(env, iss)) return json({ error: 'forbidden' }, 403);
  // トークン**本体は返さない** — 連携有無・アカウント DID・失効時刻・更新時刻のみ (監査/UI 表示用)。
  const tokens = await readServerTokens(env.OAUTH_TOKENS);
  if (!tokens) return json({ linked: false });
  return json({ linked: true, did: tokens.did, pdsUrl: tokens.pdsUrl, expiresAt: tokens.expiresAt, updatedAt: tokens.updatedAt });
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
  // 戻り先が指定されていれば web アプリの元画面 (設定等) へ 302 で返す (workers.dev に留まらない)。
  // returnTo は start 時に origin 検証済み。付与時は連携成功が確定した後なのでトークンは既に保存済み。
  if (pending.returnTo) {
    const to = new URL(pending.returnTo);
    to.searchParams.set('serverOAuth', 'linked'); // 戻り先で「連携できました」を表示するヒント
    return new Response(null, { status: 302, headers: { location: to.toString() } });
  }
  return html(`<h1>連携できました ✅</h1><p>サーバーアカウント (${tokens.did}) の書き込み認証を保存しました。このタブは閉じて構いません。</p>`);
}
