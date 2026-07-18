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
  /** 直近の DPoP-Nonce (あれば次リクエストで再利用)。 */
  dpopNonce?: string;
  /** 認可サーバー issuer (refresh / token エンドポイント解決に使う)。 */
  authServer: string;
  scope?: string;
  /** 最終更新 (epoch 秒、監査用)。 */
  updatedAt: number;
}

/** KV のキー (単一サーバーアカウント運用なので固定キー)。 */
export const SERVER_OAUTH_KEY = 'server-oauth';

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
 * DPoP-Nonce だけを更新 (read-modify-write)。リクエスト Worker が新 nonce を受けたときに使う。
 * トークン本体が無ければ何もしない (書き手競合を避けるため nonce のみ触る)。
 */
export async function updateServerNonce(kv: KVNamespace, nonce: string, now: number): Promise<void> {
  const t = await readServerTokens(kv);
  if (!t || t.dpopNonce === nonce) return;
  t.dpopNonce = nonce;
  t.updatedAt = now;
  await writeServerTokens(kv, t);
}

/** トークンを消す (ロックアウト検知時・再 OAuth 前のクリーンアップ)。 */
export async function clearServerTokens(kv: KVNamespace): Promise<void> {
  await kv.delete(SERVER_OAUTH_KEY);
}
