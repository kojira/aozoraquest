/**
 * 端末固有のユーザー設定 (localStorage)。PDS に書くほどでない軽量設定用。
 * 今は自動翻訳 ON/OFF のみ。将来の設定も同じファイルに増やしていく。
 */

const KEY_AUTO_TRANSLATE = 'aozoraquest:autoTranslate';

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
