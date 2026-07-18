/**
 * サーバーアカウント (権威 state を書き込む app サーバー用 PDS アカウント) の認証セッション管理。
 * docs/21-server-authority §4.1 / issue #346。
 *
 * M2 は public getRecord の**読み専用**だったので accessJwt を使わなかったが、M3 で権威 state に
 * **書き込む** (putRecord/deleteRecord) には認証セッションが要る。accessJwt は ~2h で失効するので:
 *   1. app-password で createSession し、モジュール内 (Worker isolate) にキャッシュ、
 *   2. 認証エラー (ExpiredToken 等) を受けたら refreshSession → だめなら createSession で再ログイン、
 *   3. 1 回だけリトライ、
 * を `withServerAuth` に閉じ込める。認証情報は Worker Secret (`SERVER_HANDLE` / `SERVER_APP_PASSWORD`)。
 */
import { createSession, refreshSession, PdsError, type PdsSession } from './pds';

/** サーバーアカウント認証情報 (Worker Secret)。読み取り用 SERVER_PDS_URL / SERVER_DID は router.ts の Env。 */
export interface ServerAuthEnv {
  SERVER_PDS_URL?: string;
  /** サーバーアカウントの handle か DID (createSession の identifier)。 */
  SERVER_HANDLE?: string;
  /** サーバーアカウントの app-password (Secret)。 */
  SERVER_APP_PASSWORD?: string;
}

/** Worker isolate 内のセッションキャッシュ (ベストエフォート。isolate をまたいでは共有されない)。 */
let cached: PdsSession | null = null;

/** テスト用: キャッシュを消す。 */
export function __resetServerSession(): void {
  cached = null;
}

export class ServerConfigError extends Error {}

function credentials(env: ServerAuthEnv): { pdsUrl: string; identifier: string; password: string } {
  const pdsUrl = env.SERVER_PDS_URL;
  const identifier = env.SERVER_HANDLE;
  const password = env.SERVER_APP_PASSWORD;
  if (!pdsUrl || !identifier || !password) {
    // fail-closed: 認証情報が無ければ書き込み系は 503 に倒す (docs/21 §3-6)。
    throw new ServerConfigError('サーバーアカウント認証情報 (SERVER_PDS_URL/SERVER_HANDLE/SERVER_APP_PASSWORD) が未設定');
  }
  return { pdsUrl, identifier, password };
}

/** 認証セッションを取得 (キャッシュ優先。`force` で作り直し)。 */
export async function getServerSession(env: ServerAuthEnv, opts: { force?: boolean } = {}): Promise<PdsSession> {
  if (cached && !opts.force) return cached;
  const { pdsUrl, identifier, password } = credentials(env);
  cached = await createSession(pdsUrl, identifier, password);
  return cached;
}

/** 認証エラー (アクセストークン失効/無効) か判定。 */
function isAuthError(e: unknown): boolean {
  if (!(e instanceof PdsError)) return false;
  if (e.status === 401) return true;
  return e.xrpcError === 'ExpiredToken' || e.xrpcError === 'InvalidToken' || e.xrpcError === 'AuthenticationRequired';
}

/**
 * 認証済みセッションで書き込み操作 `op` を実行。accessJwt 失効時は refresh → だめなら再ログインして
 * **1 回だけ**リトライする。`op` は冪等/再実行安全であること (readModifyWrite 単位で包むのが前提。
 * CAS ループの内側ではなく外側で包む → refresh 後は state を読み直してやり直せる)。
 */
export async function withServerAuth<T>(env: ServerAuthEnv, op: (session: PdsSession) => Promise<T>): Promise<T> {
  const session = await getServerSession(env);
  try {
    return await op(session);
  } catch (e) {
    if (!isAuthError(e)) throw e;
    // refresh を試み、失敗したら app-password で再ログイン。
    let next: PdsSession;
    try {
      next = await refreshSession(session);
      cached = next;
    } catch {
      next = await getServerSession(env, { force: true });
    }
    return await op(next); // 1 回だけリトライ (ここでも失敗したら throw)
  }
}
