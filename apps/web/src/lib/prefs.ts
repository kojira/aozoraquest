/**
 * 端末固有のユーザー設定 (localStorage)。PDS に書くほどでない軽量設定用。
 */

const KEY_AUTO_TRANSLATE = 'aozoraquest:autoTranslate';
const KEY_ANALYZE_POSTS = 'aozoraquest:analyzePosts';

export function getAutoTranslate(): boolean {
  try {
    const v = localStorage.getItem(KEY_AUTO_TRANSLATE);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

export function setAutoTranslate(v: boolean): void {
  try {
    localStorage.setItem(KEY_AUTO_TRANSLATE, String(v));
  } catch {
    /* no-op */
  }
}

/** TL の各投稿に cognitive function (Fe/Ni 等) の判定バッジを表示するか。
 *  ONNX classifier (~500MB) を起動するため負荷が大きい。デフォルト OFF。 */
export function getAnalyzePosts(): boolean {
  try {
    return localStorage.getItem(KEY_ANALYZE_POSTS) === 'true';
  } catch {
    return false;
  }
}

export function setAnalyzePosts(v: boolean): void {
  try {
    localStorage.setItem(KEY_ANALYZE_POSTS, String(v));
  } catch {
    /* no-op */
  }
}
