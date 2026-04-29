import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser';

/**
 * OAuth クライアントをシングルトンで初期化する。
 *
 * 本番: client_id は ${VITE_APP_URL}/client-metadata.json (build 時生成)
 * 開発: loopback client_id パターン (http://localhost で使える仮想 client_id)
 *
 * session 削除イベントは `onSessionDeleted(listener)` で subscribe できる。
 * session.ts がこれを使って削除瞬間に signed-out に flip する
 * (「session was deleted by another process」cascade を window-1 で打ち切る)。
 */
let clientPromise: Promise<BrowserOAuthClient> | null = null;

type SessionDeletedListener = (sub: string, cause: unknown) => void;
const sessionDeletedListeners = new Set<SessionDeletedListener>();

/**
 * SessionStore (IDB) から session が消された瞬間を subscribe する。
 *
 * `cached-getter.ts:142` の `deleteOnError` 経由で oauth-client が IDB
 * から session を消したとき、ここに登録された listener が同期的に呼ばれる。
 * session.ts が signed-out に倒すために使う。
 *
 * @returns unsubscribe 関数
 */
export function onSessionDeleted(listener: SessionDeletedListener): () => void {
  sessionDeletedListeners.add(listener);
  return () => {
    sessionDeletedListeners.delete(listener);
  };
}

/** OAuth client に渡す共通の hook 群。session 寿命を console に残し、削除は listener にも通知する。 */
function buildHooks() {
  return {
    onDelete: async (sub: string, cause: unknown) => {
      const causes: unknown[] = [];
      let cur: unknown = (cause as { cause?: unknown })?.cause;
      for (let i = 0; i < 5 && cur; i++) {
        causes.push(cur);
        cur = (cur as { cause?: unknown })?.cause;
      }
      console.error('[oauth/onDelete] session removed from store', {
        sub,
        cause,
        name: (cause as Error)?.name,
        message: (cause as Error)?.message,
        stack: (cause as Error)?.stack,
        causes,
        timestamp: new Date().toISOString(),
      });
      for (const l of sessionDeletedListeners) {
        try {
          l(sub, cause);
        } catch (e) {
          console.warn('[oauth/onDelete] listener threw', e);
        }
      }
    },
    onUpdate: async (sub: string, session: unknown) => {
      const tokenSet = (session as { tokenSet?: { expires_at?: string; sub?: string; scope?: string } } | undefined)
        ?.tokenSet;
      console.info('[oauth/onUpdate] session written to store', {
        sub,
        tokenSub: tokenSet?.sub,
        expiresAt: tokenSet?.expires_at,
        scope: tokenSet?.scope,
        timestamp: new Date().toISOString(),
      });
    },
  };
}

export function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (clientPromise) return clientPromise;

  const isDev = import.meta.env.DEV;
  const appUrl = import.meta.env.VITE_APP_URL || location.origin;
  const hooks = buildHooks();

  if (isDev) {
    // RFC 8252: ループバック redirect_uri には 127.0.0.1 を使う (localhost は不可)。
    // clientId 側のプレフィックスだけは http://localhost が必須なので食い違って見えるが仕様。
    // ブラウザ自体も 127.0.0.1 で開いてもらう必要がある (そうでないと認可後に元のタブに戻れない)。
    const loopbackUri = appUrl.replace(/^http:\/\/localhost([:/]|$)/, 'http://127.0.0.1$1');
    const redirectUri = `${loopbackUri}/oauth/callback`;
    clientPromise = BrowserOAuthClient.load({
      clientId: `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('atproto transition:generic')}`,
      handleResolver: 'https://bsky.social',
      ...hooks,
    });
  } else {
    // 各 origin が自分の client-metadata.json を提供する (vite.config.ts の
    // clientMetadataPlugin が VITE_APP_URL から build 時に生成)。
    // client_id は metadata の URL と一致している必要があるので、ここでも
    // 同じ origin を使う。
    clientPromise = BrowserOAuthClient.load({
      clientId: `${appUrl}/client-metadata.json`,
      handleResolver: 'https://bsky.social',
      ...hooks,
    });
  }
  return clientPromise;
}

/** 起動時にセッションを復元する。前回ログインしていれば session を返す。
 *  StrictMode の 2 重発火や複数 SessionProvider 下でも init() を 1 回にするため、
 *  Promise をモジュールスコープでキャッシュする (callback URL 上で init() が 2 回走ると
 *  1 回目が code を消費し 2 回目が state 未発見で失敗する)。 */
let initPromise: Promise<OAuthSession | null> | null = null;
export async function restoreSession(): Promise<OAuthSession | null> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const client = await getOAuthClient();
    const result = await client.init();
    return result?.session ?? null;
  })();
  return initPromise;
}

/** ログインフローを開始 (authorize 画面にリダイレクト) */
export async function signIn(handle: string): Promise<never> {
  const client = await getOAuthClient();
  await client.signIn(handle);
  throw new Error('unreachable'); // signIn() はリダイレクトで戻らない
}

export async function signOut(did: string): Promise<void> {
  const client = await getOAuthClient();
  await client.revoke(did);
}
