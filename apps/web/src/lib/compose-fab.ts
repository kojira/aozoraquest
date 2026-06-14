/**
 * 投稿作成フローティングボタン (compose FAB) の表示可否ロジック。
 * 入力フォーム / 認証 / 規約などタイムラインでない画面では出さない
 * (送信ボタン等と被って文脈ノイズになるため)。
 */

/** FAB を出さない route 接頭辞。 */
export const FAB_HIDDEN_PREFIXES = [
  '/onboarding',
  '/settings',
  '/board/new',
  '/oauth/callback',
  '/tos',
  '/privacy',
  '/me/card',
] as const;

/** その pathname で投稿 FAB を出してよいか (タイムライン系=true、フォーム/認証系=false)。 */
export function composeFabAllowedOnPath(pathname: string): boolean {
  return !FAB_HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
