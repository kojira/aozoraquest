/**
 * PC 左ナビレールの「投稿」ボタンと workspace の「投稿カラム」をつなぐ軽量 store。
 *
 * AppShell (レールの投稿ボタン) が openComposePane() を呼び、workspace (Outlet 配下)
 * が useComposePaneOpen() を購読して投稿カラムを出し入れする。親子逆方向の伝搬なので
 * context ではなく module-level external store (useSyncExternalStore) にする
 * (visible-column.ts と同じ流儀)。
 *
 * モバイルはレールを出さず右下 FAB → モーダルなので、この store は実質 PC 専用。
 */
import { useSyncExternalStore } from 'react';

let open = false;
const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) {
    try { fn(); } catch {/* no-op */}
  }
}

export function openComposePane(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeComposePane(): void {
  if (!open) return;
  open = false;
  emit();
}

export function toggleComposePane(): void {
  open = !open;
  emit();
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

export function useComposePaneOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => open);
}
