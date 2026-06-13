/**
 * workspace で「いま主に見えているカラムの kind」を共有する軽量 store
 * (docs/16-multicolumn.md §footer-nav 連動)。
 *
 * workspace (Outlet 配下) が IntersectionObserver で検出して publish し、
 * AppShell (親) の footer-nav が subscribe して active 表示に使う。
 * 親子逆方向の伝搬なので context ではなく module-level pub/sub にする。
 */
import { useEffect, useState } from 'react';
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

export function useVisibleColumn(): AppColumnKind | null {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((c) => c + 1);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return current;
}
