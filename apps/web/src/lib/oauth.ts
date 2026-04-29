import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser';

/**
 * OAuth クライアントをシングルトンで初期化する。
 *
 * 本番: client_id は ${VITE_APP_URL}/client-metadata.json (build 時生成)
 * 開発: loopback client_id パターン (http://localhost で使える仮想 client_id)
 *
 * 計測: onDelete/onUpdate/fetch hook で session 寿命を可視化する
 * (「session deleted」エラーの根本原因特定用、対症ではない)
 */
let clientPromise: Promise<BrowserOAuthClient> | null = null;

/** /oauth/token endpoint へのリクエストを fetch wrap で識別する。 */
function isTokenEndpoint(url: string): boolean {
  return /\/oauth\/(?:token|revoke|par|introspect)\b/.test(url);
}

/** OAuth client に渡す共通の hook 群。session 寿命を全部 console に残す。 */
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
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const isOAuth = isTokenEndpoint(url);
      const t0 = performance.now();
      try {
        const res = await fetch(input, init);
        if (isOAuth || !res.ok) {
          // token endpoint と非 2xx だけ詳細ログ。それ以外はノイズ抑制。
          let bodyPreview: string | undefined;
          if (isOAuth || res.status >= 400) {
            try {
              const clone = res.clone();
              const text = await clone.text();
              bodyPreview = text.slice(0, 500);
            } catch {
              /* ignore */
            }
          }
          (res.ok ? console.info : console.warn)('[oauth/fetch]', {
            method: init?.method ?? 'GET',
            url,
            status: res.status,
            ok: res.ok,
            durationMs: Math.round(performance.now() - t0),
            bodyPreview,
          });
        }
        return res;
      } catch (e) {
        console.error('[oauth/fetch] threw', { url, error: e, durationMs: Math.round(performance.now() - t0) });
        throw e;
      }
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
