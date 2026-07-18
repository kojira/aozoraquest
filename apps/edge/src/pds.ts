/**
 * 最小の PDS クライアント (fetch ベースの XRPC。docs/21-server-authority §4.1)。
 *
 * edge Worker がゲーム経済の権威 state を **app サーバー用アカウントの PDS** に読み書きする
 * ための薄いクライアント。バンドルを小さく保つため `@atproto/api` は使わず、XRPC を素の
 * fetch で叩く (Workers ネイティブ)。認証はサーバーアカウントの app-password (Worker Secret)。
 *
 * 権威 state はサーバーアカウントの repo に **ユーザー DID をキーにした 1 レコード/人**で持つ
 * ので、ユーザーは書けない = 偽造不可。二重使用防止は putRecord の `swapRecord` (期待 CID)
 * による compare-and-swap で行う (§4.1 の read-modify-write 契約と併用)。
 */

export class PdsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** XRPC のエラー名 (例 InvalidSwap = CAS 競合)。 */
    readonly xrpcError?: string,
  ) {
    super(message);
  }
}

export interface PdsSession {
  pdsUrl: string;
  accessJwt: string;
  refreshJwt: string;
  did: string;
}

async function xrpc<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  // 非 JSON 応答 (502 HTML / プロキシエラー等) の JSON.parse 例外を PdsError にラップして
  // 上位が「PDS 由来」と識別できるようにする (素の SyntaxError を漏らさない)。
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new PdsError(`XRPC 非 JSON 応答 (${res.status})`, res.status);
    }
  }
  if (!res.ok) {
    throw new PdsError(`XRPC ${res.status}: ${(body.message as string) ?? url}`, res.status, body.error as string | undefined);
  }
  return body as T;
}

/** app-password でセッション作成 (サーバーアカウント用)。 */
export async function createSession(pdsUrl: string, identifier: string, password: string): Promise<PdsSession> {
  const data = await xrpc<{ accessJwt: string; refreshJwt: string; did: string }>(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  return { pdsUrl, accessJwt: data.accessJwt, refreshJwt: data.refreshJwt, did: data.did };
}

/** refreshJwt でアクセストークンを更新。 */
export async function refreshSession(session: PdsSession): Promise<PdsSession> {
  const data = await xrpc<{ accessJwt: string; refreshJwt: string; did: string }>(`${session.pdsUrl}/xrpc/com.atproto.server.refreshSession`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.refreshJwt}` },
  });
  return { pdsUrl: session.pdsUrl, accessJwt: data.accessJwt, refreshJwt: data.refreshJwt, did: data.did };
}

export interface RecordResult<T = unknown> {
  uri: string;
  cid: string;
  value: T;
}

/** レコード取得 (public read、認証不要)。存在しなければ null。 */
export async function getRecord<T = unknown>(pdsUrl: string, repo: string, collection: string, rkey: string): Promise<RecordResult<T> | null> {
  const q = new URLSearchParams({ repo, collection, rkey });
  try {
    return await xrpc<RecordResult<T>>(`${pdsUrl}/xrpc/com.atproto.repo.getRecord?${q}`, { method: 'GET' });
  } catch (e) {
    // 不在は RecordNotFound のみで null に。他の 400 (InvalidRequest 等) は握り潰さず throw。
    if (e instanceof PdsError && e.xrpcError === 'RecordNotFound') return null;
    throw e;
  }
}

/**
 * レコード put (認証要)。`swapRecord` を渡すと compare-and-swap:
 *   - 期待 CID (既存レコードの cid) を渡す → その CID のときだけ上書き (競合は InvalidSwap)。
 *   - null を渡す → 「まだ存在しない」ときだけ作成 (既存があれば InvalidSwap)。
 *   - undefined → 無条件 put (CAS しない)。
 * CAS 競合は PdsError.xrpcError === 'InvalidSwap' で判別し、呼び出し側が read-modify-write で再試行する。
 */
export async function putRecord(
  session: PdsSession,
  collection: string,
  rkey: string,
  record: object,
  swapRecord?: string | null,
): Promise<{ uri: string; cid: string }> {
  const body: Record<string, unknown> = { repo: session.did, collection, rkey, record };
  if (swapRecord !== undefined) body.swapRecord = swapRecord;
  return xrpc<{ uri: string; cid: string }>(`${session.pdsUrl}/xrpc/com.atproto.repo.putRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify(body),
  });
}
