/**
 * AT Protocol の外部つなぎ先 (単一の出所)。
 *
 * 既定は本物の Bluesky ネットワーク。ローカルだけで遊ぶ環境 (scripts/local-world、#1018) は
 * ビルド時の VITE_* 変数でローカルの PLC / PDS に差し替える。**未設定なら既定のまま**
 * (dev / 本番の動きは変わらない)。
 *
 * - VITE_PLC_DIRECTORY_URL   … did:plc の解決先 (既定 https://plc.directory)
 * - VITE_PUBLIC_APPVIEW_URL  … 無認証で読む公開 AppView (既定 https://api.bsky.app)
 * - VITE_HANDLE_RESOLVER_URL … OAuth ログイン時のハンドル解決 (既定 https://bsky.social)
 * - VITE_ATPROTO_ALLOW_HTTP  … "1" のとき OAuth が http の PDS / 認可サーバーを許す。
 *                              **開発サーバー (vite dev) でだけ**効く (本番ビルドでは常に false)。
 */
function envUrl(value: string | undefined, fallback: string): string {
  const v = value?.trim().replace(/\/+$/, '');
  return v ? v : fallback;
}

export const PLC_DIRECTORY_URL = envUrl(import.meta.env.VITE_PLC_DIRECTORY_URL as string | undefined, 'https://plc.directory');
export const PUBLIC_APPVIEW_URL = envUrl(import.meta.env.VITE_PUBLIC_APPVIEW_URL as string | undefined, 'https://api.bsky.app');
export const HANDLE_RESOLVER_URL = envUrl(import.meta.env.VITE_HANDLE_RESOLVER_URL as string | undefined, 'https://bsky.social');
export const ATPROTO_ALLOW_HTTP = import.meta.env.DEV && (import.meta.env.VITE_ATPROTO_ALLOW_HTTP as string | undefined)?.trim() === '1';
