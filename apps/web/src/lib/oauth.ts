import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser';

/**
 * OAuth クライアントをシングルトンで初期化する。
 *
 * 本番: client_id は https://aozoraquest.app/client-metadata.json
 * 開発: loopback client_id パターン (http://localhost で使える仮想 client_id)
 */
let clientPromise: Promise<BrowserOAuthClient> | null = null;

export function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (clientPromise) return clientPromise;

  const isDev = import.meta.env.DEV;
  const appUrl = import.meta.env.VITE_APP_URL || location.origin;

  if (isDev) {
    // RFC 8252: ループバック redirect_uri には 127.0.0.1 を使う (localhost は不可)。
    // clientId 側のプレフィックスだけは http://localhost が必須なので食い違って見えるが仕様。
    // ブラウザ自体も 127.0.0.1 で開いてもらう必要がある (そうでないと認可後に元のタブに戻れない)。
    const loopbackUri = appUrl.replace(/^http:\/\/localhost([:/]|$)/, 'http://127.0.0.1$1');
    const redirectUri = `${loopbackUri}/oauth/callback`;
    clientPromise = BrowserOAuthClient.load({
      clientId: `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('atproto transition:generic')}`,
      handleResolver: 'https://bsky.social',
    });
  } else {
    // 各 origin が自分の client-metadata.json を提供する (vite.config.ts の
    // clientMetadataPlugin が VITE_APP_URL から build 時に生成)。
    // client_id は metadata の URL と一致している必要があるので、ここでも
    // 同じ origin を使う。
    clientPromise = BrowserOAuthClient.load({
      clientId: `${appUrl}/client-metadata.json`,
      handleResolver: 'https://bsky.social',
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
