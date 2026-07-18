/**
 * 無限「準備しています」(restore/init ハング) の**根本原因を実機で確定する**ための dev 専用ダンプ。
 *
 * アプリがスプラッシュで固まっていても、ブラウザのコンソールで `__aozoraDumpOAuth()` を叩けば、
 *   - IndexedDB `@atproto-oauth-client` の全レコード (**トークン/鍵は伏字**・構造/期限/sub は残す)
 *   - `navigator.locks.query()` (= `@atproto-oauth-client-<sub>` の exclusive lock が held のままか)
 *   - localStorage の @atproto 系キー (伏字)
 * を 1 つの JSON にまとめて**ダウンロード**する (共有用)。lock が held なら詰まりは Web Locks 取得待ち、
 * IDB のトークンが壊れていれば IDB 主因、と切り分けられる。読み取りのみ・副作用なし。
 *
 * **本番では登録しない** (dev / VITE_NSID_ENV=dev / ローカルのみ)。トークン実体は決してダンプしない。
 */
const OAUTH_DB = '@atproto-oauth-client';

/** 起動中に飛んだ未捕捉エラー (「Script error.」= cross-origin マスク含む) をためるリングバッファ。
 *  console (Eruda) が CSP の unsafe-eval で使えない端末でも、ダンプ JSON に含めて拾えるようにする。 */
interface CapturedError { kind: 'error' | 'unhandledrejection'; message?: string | undefined; source?: string | undefined; line?: number | undefined; col?: number | undefined; stack?: string | undefined; at: string }
const errorLog: CapturedError[] = [];
let errorHandlersInstalled = false;

function installErrorCapture(): void {
  if (errorHandlersInstalled || typeof window === 'undefined') return;
  errorHandlersInstalled = true;
  const push = (e: CapturedError) => { errorLog.push(e); if (errorLog.length > 50) errorLog.shift(); };
  window.addEventListener('error', (ev) => {
    push({ kind: 'error', message: ev.message, source: ev.filename, line: ev.lineno, col: ev.colno, stack: ev.error?.stack, at: new Date().toISOString() });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason as { message?: string; stack?: string } | undefined;
    push({ kind: 'unhandledrejection', message: r?.message ?? String(ev.reason), stack: r?.stack, at: new Date().toISOString() });
  });
}

/** 秘密になりうるキー名。値を伏字にする (構造は残す)。 */
const SECRET_KEY = /(^d$)|token|secret|password|refresh|access|dpop|jwk|_jwt|privatekey|nonce|(^code$)/i;

/** 値を再帰的に伏字化。DID/URL/期限/scope 等の非秘密は残し、トークン・鍵・長い base64 だけ潰す。 */
function redact(value: unknown, keyHint = ''): unknown {
  if (typeof value === 'string') {
    if (SECRET_KEY.test(keyHint)) return `<redacted:${value.length}>`;
    if (value.length > 100) return `<long:${value.length}>`; // JWT/トークンは長い
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, keyHint));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

/** IDB を read-only で開いて全 objectStore の全レコードを読む (init が接続を握っていても read は並行可)。 */
async function readAllRecords(dbName: string): Promise<unknown> {
  return await new Promise((resolve) => {
    let settled = false;
    const done = (v: unknown) => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done({ error: 'open-timeout' }), 3_000); // ハングしても諦める
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(dbName);
    } catch (e) {
      return done({ error: String(e) });
    }
    req.onerror = () => done({ error: 'open-error' });
    req.onsuccess = () => {
      const db = req.result;
      const result: Record<string, unknown> = {};
      const stores = Array.from(db.objectStoreNames);
      if (stores.length === 0) { db.close(); return done({ stores: [], records: {} }); }
      try {
        const tx = db.transaction(stores, 'readonly');
        let remaining = stores.length;
        for (const name of stores) {
          const getAll = tx.objectStore(name).getAll();
          getAll.onsuccess = () => {
            result[name] = redact(getAll.result);
            if (--remaining === 0) { db.close(); done({ stores, records: result }); }
          };
          getAll.onerror = () => {
            result[name] = { error: 'getAll-error' };
            if (--remaining === 0) { db.close(); done({ stores, records: result }); }
          };
        }
      } catch (e) {
        db.close();
        done({ error: String(e) });
      }
    };
  });
}

/** OAuth の永続状態 (IDB + locks + localStorage) を伏字付きで集めて返す。 */
export async function collectOAuthState(): Promise<Record<string, unknown>> {
  const locks = await navigator.locks?.query?.().catch(() => undefined);
  const ls: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /atproto|oauth/i.test(k)) ls[k] = redact(localStorage.getItem(k), k);
    }
  } catch { /* localStorage 不可なら省略 */ }
  const dbNames = await (indexedDB as { databases?: () => Promise<{ name?: string }[]> }).databases?.().catch(() => undefined);
  return {
    capturedAt: new Date().toISOString(),
    href: location.href,
    userAgent: navigator.userAgent,
    capturedErrors: errorLog.slice(),
    databases: dbNames?.map((d) => d.name),
    locks: {
      held: locks?.held?.map((l) => ({ name: l.name, mode: l.mode, clientId: l.clientId })),
      pending: locks?.pending?.map((l) => ({ name: l.name, mode: l.mode })),
    },
    localStorage: ls,
    oauthDb: await readAllRecords(OAUTH_DB),
  };
}

/** dev 専用: 収集 → コンソール出力 + JSON ダウンロード。固まっていてもボタン/コンソールから叩ける。 */
export async function dumpOAuthState(): Promise<Record<string, unknown>> {
  const state = await collectOAuthState();
  console.warn('[oauth-debug] state dump (tokens redacted)', state);
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oauth-state-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  } catch (e) {
    console.warn('[oauth-debug] download failed (state is logged above)', e);
  }
  return state;
}

/** dev 環境か (この debug 機能を出す条件)。 */
export const oauthDebugEnabled =
  import.meta.env.DEV || (import.meta.env.VITE_NSID_ENV as string | undefined)?.trim() === 'dev';

/** React の外に固定ボタンを直接生やす。どの画面 (準備しています / ログイン / リダイレクト中) で
 *  固まっても・React 自体が固まっても押せるようにする (route 配置漏れ・レンダリング停止に強い)。 */
function injectFloatingButton(): void {
  if (typeof document === 'undefined') return;
  const add = () => {
    if (document.getElementById('__aozora-oauth-dump-btn')) return;
    if (!document.body) return;
    const btn = document.createElement('button');
    btn.id = '__aozora-oauth-dump-btn';
    btn.textContent = '🔧診断';
    btn.style.cssText =
      'position:fixed;right:8px;bottom:76px;z-index:2147483647;padding:10px 12px;' +
      'font-size:13px;background:#c0392b;color:#fff;border:none;border-radius:10px;opacity:0.9;box-shadow:0 2px 8px rgba(0,0,0,.4)';
    btn.addEventListener('click', (e) => { e.preventDefault(); void dumpOAuthState(); });
    document.body.appendChild(btn);
  };
  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add, { once: true });
}

/** dev / dev 環境 / ローカルのみ: 未捕捉エラー捕捉を仕込み、固定診断ボタン + `window.__aozoraDumpOAuth()`
 *  を生やす (本番では何もしない)。エラー捕捉は session 復元より前に効かせたいので import 直後に呼ぶ。 */
export function installOAuthDebug(): void {
  if (!oauthDebugEnabled || typeof window === 'undefined') return;
  installErrorCapture();
  injectFloatingButton();
  (window as unknown as { __aozoraDumpOAuth?: () => Promise<unknown> }).__aozoraDumpOAuth = dumpOAuthState;
  console.info('[oauth-debug] 右下の🔧診断ボタン (または __aozoraDumpOAuth()) でOAuth状態(伏字)をJSON保存できます');
}
