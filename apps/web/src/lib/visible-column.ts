/**
 * workspace で「いま主に見えているカラムの kind」を共有する軽量 store
 * (docs/16-multicolumn.md §footer-nav 連動)。
 *
 * workspace (Outlet 配下) が IntersectionObserver で検出して publish し、
 * AppShell (親) の footer-nav が subscribe して active 表示に使う。
 * 親子逆方向の伝搬なので context ではなく module-level の external store
 * (useSyncExternalStore) にする。
 */
import { useSyncExternalStore } from 'react';
import type { AppColumnKind } from './app-columns';

let current: AppColumnKind | null = null;
const subscribers = new Set<() => void>();

export function publishVisibleColumn(kind: AppColumnKind | null): void {
  if (current === kind) return;
  current = kind;
  for (const fn of subscribers) {
    try { fn(); } catch {/* no-op */}
  }
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

export function useVisibleColumn(): AppColumnKind | null {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
