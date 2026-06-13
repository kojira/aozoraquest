/**
 * カラムの縦スクロール要素を配る context (docs/16-multicolumn.md)。
 *
 * workspace の ColumnView が column-body 要素を provide し、配下の
 * フィードが VirtualFeed の scrollParent に渡して「カラム内スクロール」
 * モードで動く。workspace 外 (= 従来の単一ページ) では null = window
 * スクロール。
 *
 * workspace.tsx ではなく独立モジュールに置くのは循環 import 回避のため
 * (workspace → column-content/index → home-column → ここ、で一方向になる)。
 */
import { createContext, useContext } from 'react';

export const ColumnScrollContext = createContext<HTMLElement | null>(null);

export function useColumnScrollEl(): HTMLElement | null {
  return useContext(ColumnScrollContext);
}
