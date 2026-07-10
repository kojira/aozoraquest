/**
 * AT Protocol の URI (at://<did>/<collection>/<rkey>) と Bluesky スタイルの
 * web URL (/profile/<handle>/post/<rkey>) の間を行き来する小ヘルパ。
 */

export function rkeyFromUri(uri: string): string {
  return uri.split('/').pop() ?? '';
}

/** at://<did>/<collection>/<rkey> から <did> (authority) を取り出す。取れなければ空文字。
 *  collection/rkey が無い (末尾スラッシュ無し) at-uri でも authority だけは拾う。 */
export function didFromUri(uri: string): string {
  const m = /^at:\/\/([^/]+)/.exec(uri);
  return m ? m[1]! : '';
}

export function postUri(did: string, rkey: string): string {
  return `at://${did}/app.bsky.feed.post/${rkey}`;
}

/** /profile/:handle/post/:rkey を組み立てる。handle が空なら AT URI にフォールバック。 */
export function postDetailPath(handle: string | undefined | null, uri: string): string {
  const rkey = rkeyFromUri(uri);
  if (!handle) return `/post/${encodeURIComponent(uri)}`;
  return `/profile/${handle}/post/${rkey}`;
}
