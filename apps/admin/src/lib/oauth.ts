import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser';

/**
 * Admin app 用 OAuth クライアント。web と別 origin/クライアント ID。
 */
let clientPromise: Promise<BrowserOAuthClient> | null = null;

export function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (clientPromise) return clientPromise;

  const isDev = import.meta.env.DEV;
  const appUrl = import.meta.env.VITE_APP_URL || location.origin;

  if (isDev) {
    // RFC 8252: redirect_uri は 127.0.0.1 必須 (localhost 不可)。
    // ブラウザ自体も 127.0.0.1 で開く必要あり。
    const loopbackUri = appUrl.replace(/^http:\/\/localhost([:/]|$)/, 'http://127.0.0.1$1');
    const redirectUri = `${loopbackUri}/oauth/callback`;
    clientPromise = BrowserOAuthClient.load({
      clientId: `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('atproto transition:generic')}`,
      handleResolver: 'https://bsky.social',
    });
  } else {
    clientPromise = BrowserOAuthClient.load({
      clientId: `${appUrl}/client-metadata.json`,
      handleResolver: 'https://bsky.social',
    });
  }
  return clientPromise;
}

export async function restoreSession(): Promise<OAuthSession | null> {
  const client = await getOAuthClient();
  const result = await client.init();
  return result?.session ?? null;
}

export async function signIn(handle: string): Promise<never> {
  const client = await getOAuthClient();
  await client.signIn(handle);
  throw new Error('unreachable');
}

export async function signOut(did: string): Promise<void> {
  const client = await getOAuthClient();
  await client.revoke(did);
}
