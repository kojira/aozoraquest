import { useEffect } from 'react';

/**
 * ワールドを開いている間、画面全体 (ヘッダー・footer・会話・HUD・戦闘・各モーダル) で
 * 文字選択を止める (#996)。スマホで文字が選択されると、次の指の動きが選択範囲の
 * 伸ばしに取られてスティックが動かなくなることがあるため。
 * `.world-screen` だけに user-select を付けても、その外 (AppShell のヘッダー/footer など)
 * から選択が始まるので、ルートの <html> にクラスを付けて CSS (base.css) と selectstart で止める。
 * 入力欄 (値段・名前・チャットなど) は選べるまま。
 */
export const WORLD_NO_SELECT_CLASS = 'aq-world-no-select';

const EDITABLE = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

function inEditable(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  return !!el?.closest(EDITABLE);
}

/** 入力欄の外に選択が残っていたら消す。歩き出すとき (スティック・キー) に呼ぶ。 */
export function clearStraySelection(): void {
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!selection || selection.isCollapsed || inEditable(selection.anchorNode)) return;
  selection.removeAllRanges();
}

export function useWorldTextSelectGuard(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(WORLD_NO_SELECT_CLASS);
    const onSelectStart = (e: Event) => {
      if (!inEditable(e.target as Node | null)) e.preventDefault();
    };
    document.addEventListener('selectstart', onSelectStart);
    return () => {
      root.classList.remove(WORLD_NO_SELECT_CLASS);
      document.removeEventListener('selectstart', onSelectStart);
    };
  }, []);
}
