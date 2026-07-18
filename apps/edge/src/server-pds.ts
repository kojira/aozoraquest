/**
 * サーバーアカウント PDS への **OAuth (DPoP) 認証付き書き込み** — docs/21 §12.3 / M3。
 *
 * M2.5 で取得・保管した OAuth トークン (KV) を使い、サーバーアカウント (kojira.io) の PDS に
 * putRecord / deleteRecord する。書き込みは DPoP バインド (sender-constrained) で、access token +
 * DPoP 鍵 (Worker Secret) + PDS 用 DPoP-Nonce (別 KV キー) を使う。
 *
 * **request Worker は refresh しない** (直列化維持 = §12.3)。token 失効/未 bootstrap は fail-closed で
 * ServerWriteError を投げ、上位は 503 に倒す (次の cron 補充を待つ)。読み取りは public getRecord
 * (pds.ts) で足りるので本モジュールは書き込み専用。
 */
import { dpopFetch } from './dpop-fetch';
import { readServerTokens, readPdsNonce, writePdsNonce } from './oauth-store';
import { loadOAuthConfig, OAuthConfigError, type OAuthEnv } from './oauth-config';
import { PdsError } from './pds';

export interface ServerPdsEnv extends OAuthEnv {
  OAUTH_TOKENS?: KVNamespace;
}

/** 書き込み不能 (fail-closed) の理由。上位は 503 に振り分ける。 */
export class ServerWriteError extends Error {
  constructor(message: string, readonly reason: 'no-kv' | 'not-bootstrapped' | 'token-expired' | 'not-configured') {
    super(message);
  }
}

/** サーバー PDS への認証付き XRPC (POST/JSON)。DPoP + access token を付け、nonce を KV に反映。 */
async function authedXrpc<T>(env: ServerPdsEnv, now: number, nsid: string, body: object): Promise<T> {
  if (!env.OAUTH_TOKENS) throw new ServerWriteError('KV 未 binding', 'no-kv');
  const kv = env.OAUTH_TOKENS;
  const tokens = await readServerTokens(kv);
  if (!tokens) throw new ServerWriteError('サーバートークン未 bootstrap (管理画面で OAuth 連携が必要)', 'not-bootstrapped');
  if (now >= tokens.expiresAt) throw new ServerWriteError('access token 失効 (cron 補充待ち)', 'token-expired');
  let cfg;
  try {
    cfg = loadOAuthConfig(env);
  } catch (e) {
    if (e instanceof OAuthConfigError) throw new ServerWriteError(e.message, 'not-configured');
    throw e;
  }

  const nonce = (await readPdsNonce(kv)) ?? undefined;
  let latest = nonce;
  // repo は常にサーバーアカウント (kojira.io) の DID。呼び出し側は指定不要。
  const res = await dpopFetch(
    `${tokens.pdsUrl}/xrpc/${nsid}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo: tokens.did, ...body }) },
    { jwk: cfg.dpopJwk, accessToken: tokens.accessToken, now, nonce, onNonce: (n) => { latest = n; } },
  );
  if (latest && latest !== nonce) await writePdsNonce(kv, latest); // 次回のため保存 (別キー)

  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new PdsError(`XRPC 非 JSON 応答 (${res.status})`, res.status);
    }
  }
  if (!res.ok) throw new PdsError(`XRPC ${res.status}: ${(json.message as string) ?? nsid}`, res.status, json.error as string | undefined);
  return json as T;
}

/**
 * サーバー repo に putRecord (認証付き)。`swapRecord` で CAS:
 *   期待 CID → その CID のときだけ上書き / null → 未存在のときだけ作成 / undefined → 無条件。
 * CAS 競合は PdsError.xrpcError === 'InvalidSwap'。
 */
export async function serverPutRecord(
  env: ServerPdsEnv,
  now: number,
  collection: string,
  rkey: string,
  record: object,
  swapRecord?: string | null,
): Promise<{ uri: string; cid: string }> {
  const body: Record<string, unknown> = { collection, rkey, record };
  if (swapRecord !== undefined) body.swapRecord = swapRecord;
  return authedXrpc<{ uri: string; cid: string }>(env, now, 'com.atproto.repo.putRecord', body);
}

/** サーバー repo の deleteRecord (認証付き、swapRecord CAS 対応)。 */
export async function serverDeleteRecord(env: ServerPdsEnv, now: number, collection: string, rkey: string, swapRecord?: string): Promise<void> {
  const body: Record<string, unknown> = { collection, rkey };
  if (swapRecord !== undefined) body.swapRecord = swapRecord;
  await authedXrpc(env, now, 'com.atproto.repo.deleteRecord', body);
}
