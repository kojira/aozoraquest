/**
 * AT Protocol OAuth confidential client のフロー — docs/21 §12。
 *
 * PKCE + PAR(Pushed Authorization Request) で authorize URL を作り、callback の code を token に
 * 交換し、refresh する。クライアント認証は private_key_jwt、リクエストは DPoP バインド(nonce
 * handshake は dpopFetch が処理)。トークンエンドポイント/PAR は form-urlencoded。
 */
import { sha256 } from '@noble/hashes/sha256';
import { base64urlnopad } from '@scure/base';
import { clientAssertion, type EcJwk } from './oauth-jwt';
import { dpopFetch } from './dpop-fetch';
import type { AuthServerMetadata } from './oauth-metadata';
import type { ServerOAuthTokens } from './oauth-store';

const enc = new TextEncoder();
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** PKCE の code_verifier / code_challenge(S256)。`rand` を渡すとテストで固定できる。 */
export function generatePkce(rand?: Uint8Array): { verifier: string; challenge: string } {
  const bytes = rand ?? crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64urlnopad.encode(bytes); // 43 文字、PKCE 許容文字のみ
  const challenge = base64urlnopad.encode(sha256(enc.encode(verifier)));
  return { verifier, challenge };
}

/** CSRF 用 state。 */
export function generateState(rand?: Uint8Array): string {
  return base64urlnopad.encode(rand ?? crypto.getRandomValues(new Uint8Array(16)));
}

/** トークンエンドポイント応答 (使う項目)。 */
interface TokenResponse {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  sub?: string;
}

interface ClientConfig {
  clientId: string;
  redirectUri: string;
  scope: string;
  clientJwk: EcJwk; // private_key_jwt 署名鍵
  dpopJwk: EcJwk; // DPoP 鍵
  now: number; // epoch 秒
  fetchImpl?: typeof fetch;
}

function assertion(cfg: ClientConfig, authServer: AuthServerMetadata): string {
  return clientAssertion({ jwk: cfg.clientJwk, clientId: cfg.clientId, audience: authServer.issuer, now: cfg.now });
}

async function postForm<T>(url: string, form: URLSearchParams, cfg: ClientConfig): Promise<T> {
  const res = await dpopFetch(
    url,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() },
    { jwk: cfg.dpopJwk, now: cfg.now, fetchImpl: cfg.fetchImpl },
  );
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
  return body as T;
}

/**
 * PAR を実行して authorize URL を組み立てる。返す `state`/`verifier` は callback まで(KV 等に)
 * 保存し、callback で照合・交換に使う。`loginHint` はサーバーアカウントの handle/DID(ログイン先誘導)。
 */
export async function buildAuthorizeUrl(
  cfg: ClientConfig,
  authServer: AuthServerMetadata,
  opts: { loginHint?: string; state?: string; pkce?: { verifier: string; challenge: string } } = {},
): Promise<{ url: string; state: string; verifier: string }> {
  const state = opts.state ?? generateState();
  const pkce = opts.pkce ?? generatePkce();
  const form = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: assertion(cfg, authServer),
  });
  if (opts.loginHint) form.set('login_hint', opts.loginHint);
  const par = await postForm<{ request_uri: string }>(authServer.pushed_authorization_request_endpoint, form, cfg);
  if (!par.request_uri) throw new Error('PAR 応答に request_uri が無い');
  const url = `${authServer.authorization_endpoint}?client_id=${encodeURIComponent(cfg.clientId)}&request_uri=${encodeURIComponent(par.request_uri)}`;
  return { url, state, verifier: pkce.verifier };
}

function normalize(t: TokenResponse, authServer: AuthServerMetadata, now: number, pdsUrl: string, expectedDid: string, opts: { requireSub?: boolean } = {}): ServerOAuthTokens {
  // bootstrap (code 交換) では sub 必須。sub 欠落を serverDid で埋めない (別アカウントの取り違え防止)。
  if (opts.requireSub && !t.sub) throw new Error('トークン応答に sub が無い (bootstrap では必須)');
  const did = t.sub ?? expectedDid;
  // アカウント取り違え/セッション固定対策: 認可されたアカウントが期待するサーバーアカウント
  // サーバーアカウントと一致することを必須にする。別アカウントでログインされてもトークンを保存しない。
  if (did !== expectedDid) throw new Error(`予期しないアカウント: ${did} ≠ ${expectedDid}`);
  if (!t.refresh_token) throw new Error('refresh_token が無い(atproto スコープの refresh 発行を要確認)');
  return {
    did,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    tokenType: t.token_type || 'DPoP',
    expiresAt: now + (t.expires_in ?? 3600),
    pdsUrl,
    authServer: authServer.issuer,
    scope: t.scope,
    updatedAt: now,
  };
}

/** callback の authorization code を token に交換する。sub は expectedDid と厳密一致必須。 */
export async function exchangeCode(
  cfg: ClientConfig,
  authServer: AuthServerMetadata,
  code: string,
  verifier: string,
  pdsUrl: string,
  expectedDid: string,
): Promise<ServerOAuthTokens> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
    client_id: cfg.clientId,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: assertion(cfg, authServer),
  });
  const t = await postForm<TokenResponse>(authServer.token_endpoint, form, cfg);
  return normalize(t, authServer, cfg.now, pdsUrl, expectedDid, { requireSub: true });
}

/** refresh_token でトークンを更新する(cron が使う)。アカウントは bootstrap 済なので sub は任意。 */
export async function refreshTokens(
  cfg: ClientConfig,
  authServer: AuthServerMetadata,
  refreshToken: string,
  pdsUrl: string,
  expectedDid: string,
): Promise<ServerOAuthTokens> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: assertion(cfg, authServer),
  });
  const t = await postForm<TokenResponse>(authServer.token_endpoint, form, cfg);
  return normalize(t, authServer, cfg.now, pdsUrl, expectedDid);
}
