/**
 * DID → handle 解決のキャッシュ層。
 *
 * AT Proto の DID (例: did:plc:abc123...) はユーザーに見せる文字列として
 * 不適。aozoraquest の UI では「kojira.io」のような handle で表示する。
 *
 * - 公開 AppView (api.bsky.app) の getProfile を使う (認証不要)
 * - メモリ Map + localStorage で 24 時間キャッシュ
 * - useHandle(did) フックは未解決中は did の先頭 (= 旧 stub と同じ) を返し、
 *   解決完了で handle に置き換わる
 */

import { useEffect, useState } from 'react';
import { AtpAgent } from '@atproto/api';

const PUBLIC_APPVIEW = 'https://api.bsky.app';
const KEY = 'aozoraquest:handleCache';
const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  handle: string;
  ts: number;
}

const memCache = new Map<string, CacheEntry>();
let loaded = false;

function loadDisk(): Record<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function saveDisk(): void {
  try {
    const obj: Record<string, CacheEntry> = {};
    for (const [k, v] of memCache) obj[k] = v;
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {/* no-op */}
}

function ensureLoaded(): void {
  if (loaded) return;
  const disk = loadDisk();
  for (const [k, v] of Object.entries(disk)) {
    if (Date.now() - v.ts < TTL_MS) memCache.set(k, v);
  }
  loaded = true;
}

const publicAgent = new AtpAgent({ service: PUBLIC_APPVIEW });

const inflight = new Map<string, Promise<string | null>>();

/** 単発の handle 解決。キャッシュにあれば即返す。 */
export async function resolveHandle(did: string): Promise<string | null> {
  ensureLoaded();
  const hit = memCache.get(did);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.handle;

  const existing = inflight.get(did);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await publicAgent.getProfile({ actor: did });
      const handle = res.data.handle;
      if (handle) {
        memCache.set(did, { handle, ts: Date.now() });
        saveDisk();
      }
      return handle ?? null;
    } catch (e) {
      console.warn('[handle-cache] resolve failed', did, e);
      return null;
    } finally {
      inflight.delete(did);
    }
  })();
  inflight.set(did, p);
  return p;
}

export type HandleState = 'loading' | 'resolved' | 'deleted';

export interface HandleResult {
  handle: string | null;
  state: HandleState;
}

/** UI 用フック: handle を取得しつつ、未解決中は loading を返す。
 *  解決失敗 (= getProfile が 4xx 等で返した) は deleted (= アカウント削除) と扱う。 */
export function useHandle(did: string | null | undefined): HandleResult {
  const [result, setResult] = useState<HandleResult>(() => {
    if (!did) return { handle: null, state: 'loading' };
    ensureLoaded();
    const hit = memCache.get(did);
    if (hit && Date.now() - hit.ts < TTL_MS) {
      return { handle: hit.handle, state: 'resolved' };
    }
    return { handle: null, state: 'loading' };
  });

  useEffect(() => {
    if (!did) return;
    let cancelled = false;
    void resolveHandle(did).then((h) => {
      if (cancelled) return;
      if (h) setResult({ handle: h, state: 'resolved' });
      else setResult({ handle: null, state: 'deleted' });
    });
    return () => { cancelled = true; };
  }, [did]);

  return result;
}
