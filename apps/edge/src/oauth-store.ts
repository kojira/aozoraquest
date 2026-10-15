/**
 * サーバーアカウントの OAuth トークンストア (Cloudflare KV) — docs/21 §12。
 *
 * cron refresher が**唯一の書き手**、リクエスト処理 Worker が読み手。KV は結果整合だが、access token は
 * refresh 後も期限まで有効なので少し古い読みでも可 (単回ローテーションが効くのは refresh token = cron のみ)。
 * DPoP-Nonce は接続をまたいで再利用するためここに保持する。
 */

/** KV に保存する OAuth セッション。1 サーバーアカウント = 1 レコード。 */
export interface ServerOAuthTokens {
  /** サーバーアカウント DID (トークンの sub)。 */
  did: string;
  accessToken: string;
  refreshToken: string;
  /** 通常 "DPoP"。 */
  tokenType: string;
  /** access token 失効時刻 (epoch 秒)。cron はこれより前に refresh する。 */
  expiresAt: number;
  /** 書き込み先 PDS URL (DID→#atproto_pds を discovery した結果)。M3 の書込がここに putRecord する。
   *  レコードに持たせておくことで書込ごとの DID doc 再解決を避ける (レビュー ★★)。 */
  pdsUrl: string;
  /** 認可サーバー issuer (refresh / token エンドポイント解決に使う)。 */
  authServer: string;
  scope?: string;
  /** refresh 進行中マーカー (epoch 秒。cron の二重 refresh = ローテーション競合を抑えるソフトロック)。 */
  refreshingUntil?: number;
  /** 最終更新 (epoch 秒、監査用)。 */
  updatedAt: number;
}

/** KV のキー (単一サーバーアカウント運用なので固定キー)。 */
export const SERVER_OAUTH_KEY = 'server-oauth';
/** PDS 用 DPoP-Nonce のキー。トークンレコードとは**別キー**にし、リクエスト Worker が nonce を
 *  更新してもトークン本体 (cron が書く) を巻き込まない (レビュー ★★: 第二の書き手クロバー回避)。 */
export const PDS_NONCE_KEY = 'oauth-pds-nonce';

/** トークンを読む (無ければ null = 未 bootstrap)。 */
export async function readServerTokens(kv: KVNamespace): Promise<ServerOAuthTokens | null> {
  const raw = await kv.get(SERVER_OAUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServerOAuthTokens;
  } catch {
    return null; // 壊れたレコードは未 bootstrap 扱い (fail-closed 側)
  }
}

/** トークンを保存 (cron の refresh 後・初回 bootstrap 時)。 */
export async function writeServerTokens(kv: KVNamespace, tokens: ServerOAuthTokens): Promise<void> {
  await kv.put(SERVER_OAUTH_KEY, JSON.stringify(tokens));
}

/**
 * PDS 用 DPoP-Nonce を読む (無ければ null)。**トークンレコードとは別キー**なので、リクエスト
 * Worker がこれを更新しても cron が書くトークン本体を巻き込まない (レビュー ★★)。
 */
export async function readPdsNonce(kv: KVNamespace): Promise<string | null> {
  return kv.get(PDS_NONCE_KEY);
}

/** PDS 用 DPoP-Nonce を保存 (リクエスト Worker が新 nonce を受けたとき)。単一フィールドの上書きのみ。 */
export async function writePdsNonce(kv: KVNamespace, nonce: string): Promise<void> {
  await kv.put(PDS_NONCE_KEY, nonce);
}

/** トークンを消す (ロックアウト検知時・再 OAuth 前のクリーンアップ)。 */
export async function clearServerTokens(kv: KVNamespace): Promise<void> {
  await kv.delete(SERVER_OAUTH_KEY);
}

/** authorize→callback 間で保持する PKCE/state (CSRF)。TTL 付きで短命に持つ。 */
export interface PendingAuth {
  /** PKCE code_verifier。 */
  verifier: string;
  /** 交換に使う認可サーバー (authorize 時に discovery したものを固定)。 */
  authServer: import('./oauth-metadata').AuthServerMetadata;
  /** 書き込み先 PDS URL (authorize 時に discovery。callback でトークンレコードに載せる)。 */
  pdsUrl: string;
  createdAt: number;
  /** 認可完了後にブラウザを戻す web アプリの URL (start 時に origin 検証済み)。省略時は完了 HTML。 */
  returnTo?: string;
}

const PENDING_PREFIX = 'oauth-pending:';
/** pending の既定 TTL (秒)。authorize→callback は数分で終わる。 */
export const PENDING_TTL_SEC = 600;

/** pending を保存 (state をキーに、TTL 付き)。 */
export async function putPendingAuth(kv: KVNamespace, state: string, data: PendingAuth, ttlSec = PENDING_TTL_SEC): Promise<void> {
  await kv.put(PENDING_PREFIX + state, JSON.stringify(data), { expirationTtl: ttlSec });
}

/** pending を取り出して削除 (使い捨て = リプレイ防止)。無効/期限切れは null。 */
export async function takePendingAuth(kv: KVNamespace, state: string): Promise<PendingAuth | null> {
  const key = PENDING_PREFIX + state;
  const raw = await kv.get(key);
  if (!raw) return null;
  await kv.delete(key);
  try {
    return JSON.parse(raw) as PendingAuth;
  } catch {
    return null;
  }
}
