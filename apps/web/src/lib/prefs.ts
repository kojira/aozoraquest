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
 *  ONNX classifier (Ruri 30m、初回 DL ~30MB) を起動する。デフォルト OFF。 */
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

const KEY_HIDE_REPOSTS = 'aozoraquest:hideReposts';

/** タイムラインからリポストを除外するか。デフォルト OFF (= リポストも表示)。 */
export function getHideReposts(): boolean {
  try {
    return localStorage.getItem(KEY_HIDE_REPOSTS) === 'true';
  } catch {
    return false;
  }
}

export function setHideReposts(v: boolean): void {
  try {
    localStorage.setItem(KEY_HIDE_REPOSTS, String(v));
  } catch {
    /* no-op */
  }
}

const KEY_FONT_SCALE = 'aozoraquest:fontScale';
export const FONT_SCALE_MIN = 50;
export const FONT_SCALE_MAX = 150;
export const FONT_SCALE_DEFAULT = 100;

/** html の font-size に乗せる % 倍率。50-150 の整数。デフォルト 100。
 *  ブラウザのデフォルト 16px に対する倍率なので、100 = 16px、80 = 12.8px。 */
export function getFontScale(): number {
  try {
    const raw = localStorage.getItem(KEY_FONT_SCALE);
    if (raw === null) return FONT_SCALE_DEFAULT;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return FONT_SCALE_DEFAULT;
    return clampFontScale(n);
  } catch {
    return FONT_SCALE_DEFAULT;
  }
}

export function setFontScale(v: number): void {
  try {
    localStorage.setItem(KEY_FONT_SCALE, String(clampFontScale(v)));
  } catch {
    /* no-op */
  }
}

export function clampFontScale(v: number): number {
  if (v < FONT_SCALE_MIN) return FONT_SCALE_MIN;
  if (v > FONT_SCALE_MAX) return FONT_SCALE_MAX;
  return Math.round(v);
}
