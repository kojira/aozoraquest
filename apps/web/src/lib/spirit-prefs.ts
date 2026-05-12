/**
 * 精霊ブルスコンの端末ローカル設定。
 *
 * 現状は「Gemini Nano (Chrome 内蔵 AI) を優先するか」のみ。
 * デフォルト true (利用可能なら Nano を使う)。
 *
 * DID 別ではなく端末別 (localStorage) なのは、HW スペックや好みは端末ごとに
 * 違うため。
 */

import { useState } from 'react';

const KEY = 'aozoraquest.spirit.useGeminiNano';

export function loadUseGeminiNano(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const v = localStorage.getItem(KEY);
  return v === null ? true : v === '1';
}

export function saveUseGeminiNano(v: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, v ? '1' : '0');
}

export function useGeminiNanoPref(): [boolean, (next: boolean) => void] {
  const [v, setV] = useState<boolean>(loadUseGeminiNano);
  const set = (next: boolean) => {
    saveUseGeminiNano(next);
    setV(next);
  };
  return [v, set];
}
