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

/** OAuth client に渡す共通の hook 群。
 *  onDelete は **同タブのローカル削除** と **別タブからの cross-tab broadcast** の
 *  両方で呼ばれる。ここでは listener に流すだけで、log は session.ts 側
 *  (実際に自分の sub に該当するもののみ) で出すようにしてノイズを抑える。 */
function buildHooks() {
  return {
    onDelete: async (sub: string, cause: unknown) => {
      // 詳細 log は session.ts の listener が「自分の sub に該当する」ときだけ出す。
      // ここでは listener へ素通しするだけ (cross-tab broadcast でも全 listener が
      // 確実に呼ばれる必要があるため早期 return しない)。
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

/** @atproto/oauth-client-browser が sub (DID) を控える localStorage キー。ロック名の算出に使う。 */
const OAUTH_SUB_LS_KEY = '@@atproto/oauth-client-browser(sub)';

/**
 * **無限「準備しています」/「リダイレクト中」の根本対策** (2026-07-19、実機 dump で確定)。
 *
 * トークン期限切れ時、`client.init()` はリフレッシュを排他ロック `@atproto-oauth-client-<sub>` で囲む
 * (session-getter.js)。**ロック取得待ちには上限が無い**。iOS はバックグラウンドタブの JS/タイマーを凍結
 * するため、別タブ (や凍結した前のタブ) がこのロックを握ったままだと、その中の 30s abort も凍結されて
 * **ロックが永久に解放されず**、前面タブの init()/getSession が無限ハングする (dump: held×1 + pending×2)。
 *
 * 起動時、**まだ自分が何も acquire していない時点**でロックが held なら、それは他コンテキストの掴みっぱなし
 * なので `navigator.locks` の **steal** で強制解放する (holder の callback は AbortError で reject → @atproto は
 * refresh の並行性から回復する設計)。取得後は即手放し、待機者と自分の復元が進めるようにする。best-effort。
 *
 * @returns steal を実行したら true。
 */
export async function breakStaleOAuthLock(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.locks?.query || !navigator.locks?.request) return false;
    const sub = localStorage.getItem(OAUTH_SUB_LS_KEY);
    if (!sub) return false;
    const name = `@atproto-oauth-client-${sub}`;
    const q = await navigator.locks.query();
    // 自分はまだ acquire していないので、held = 他コンテキスト (凍結タブ等) の掴みっぱなし。
    if (!q.held?.some((l) => l.name === name)) return false;
    console.warn('[oauth] stale session lock held by another context; stealing to break deadlock', { name });
    await navigator.locks.request(name, { steal: true }, async () => { /* 取れたら即解放 */ });
    return true;
  } catch (e) {
    console.warn('[oauth] breakStaleOAuthLock failed', e);
    return false;
  }
}

/** 壊れた/不整合な永続 OAuth セッションを消す (init() がハングして無限「準備しています」になる
 *  ケースからの復旧用)。`@atproto/oauth-client-browser` は IndexedDB `@atproto-oauth-client` に
 *  session/token を保存する。**best-effort**: init() が接続を掴んでいると deleteDatabase は blocked に
 *  なるが、その場合も待たずに返す (次回リロードで実際に消える)。キャッシュした client/init も破棄して
 *  次の restoreSession がクリーンな client を作り直せるようにする。 */
export async function clearOAuthStorage(): Promise<void> {
  // キャッシュを捨てて次の restoreSession が client を作り直せるようにする。ハング中の init() 自体は
  // abort できないので orphan として裏で走り続けるが、UI はもうログイン画面なので無害
  // (真の復旧レバーは下の IDB 削除)。IDB '@atproto-oauth-client' は全アカウント共通の単一 DB なので
  // これは「このブラウザの全 Bluesky OAuth セッション」を消す (現状シングルアカウントなので実害なし)。
  initPromise = null;
  clientPromise = null;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    try {
      const req = indexedDB.deleteDatabase('@atproto-oauth-client');
      req.onsuccess = finish;
      req.onerror = finish;
      req.onblocked = finish; // 開いた接続で blocked でも永久待ちしない (次回リロードで消える)
    } catch {
      finish();
    }
    setTimeout(finish, 2_000); // 保険: イベントが来なくても 2s で諦める
  });
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
