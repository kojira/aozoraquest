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

function hasLocalStorage(): boolean {
  try {
    return typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function loadDisk(): Record<string, CacheEntry> {
  if (!hasLocalStorage()) return {};
  try {
    const raw = globalThis.localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function saveDisk(): void {
  if (!hasLocalStorage()) return;
  try {
    const obj: Record<string, CacheEntry> = {};
    for (const [k, v] of memCache) obj[k] = v;
    globalThis.localStorage.setItem(KEY, JSON.stringify(obj));
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

// AtpAgent インスタンスは初回利用時に生成 (= モジュール top-level での副作用を避ける、SSR-safe)
let _publicAgent: AtpAgent | null = null;
function publicAgent(): AtpAgent {
  if (!_publicAgent) _publicAgent = new AtpAgent({ service: PUBLIC_APPVIEW });
  return _publicAgent;
}

/** resolve の結果区分。
 *  - { kind: 'ok', handle } : 解決成功
 *  - { kind: 'deleted' } : AppView が 4xx で「存在しない」と返した
 *  - { kind: 'transient' } : ネットワーク/レート制限/5xx (一時的)
 */
export type ResolveResult =
  | { kind: 'ok'; handle: string }
  | { kind: 'deleted' }
  | { kind: 'transient' };

const inflight = new Map<string, Promise<ResolveResult>>();

function classifyError(e: unknown): 'deleted' | 'transient' {
  // @atproto/api は失敗時に { status } を持つ。4xx = NotFound 系、5xx と TypeError = transient
  const status = (e as { status?: number })?.status;
  if (typeof status === 'number') {
    if (status === 400 || status === 404) return 'deleted';
    return 'transient';
  }
  return 'transient';
}

/** 単発の handle 解決。キャッシュにあれば即返す。失敗時は kind で transient/deleted を区別 */
export async function resolveHandleDetailed(did: string): Promise<ResolveResult> {
  ensureLoaded();
  const hit = memCache.get(did);
  if (hit && Date.now() - hit.ts < TTL_MS) return { kind: 'ok', handle: hit.handle };

  const existing = inflight.get(did);
  if (existing) return existing;

  const p = (async (): Promise<ResolveResult> => {
    try {
      const res = await publicAgent().getProfile({ actor: did });
      const handle = res.data.handle;
      if (handle) {
        memCache.set(did, { handle, ts: Date.now() });
        saveDisk();
        return { kind: 'ok', handle };
      }
      return { kind: 'deleted' };
    } catch (e) {
      const cls = classifyError(e);
      if (cls === 'transient') {
        console.warn('[handle-cache] transient resolve failure', did, e);
      } else {
        console.info('[handle-cache] account looks deleted', did);
      }
      return { kind: cls };
    } finally {
      inflight.delete(did);
    }
  })();
  inflight.set(did, p);
  return p;
}

/** 互換 API: 解決できなかった場合は (deleted も transient も) null。 */
export async function resolveHandle(did: string): Promise<string | null> {
  const r = await resolveHandleDetailed(did);
  return r.kind === 'ok' ? r.handle : null;
}

export type HandleState = 'loading' | 'resolved' | 'deleted' | 'transient';

export interface HandleResult {
  handle: string | null;
  state: HandleState;
}

/** UI 用フック: handle を取得しつつ、未解決中は loading を返す。
 *  - kind='ok'        → resolved
 *  - kind='deleted'   → deleted (削除済み = グレー表示)
 *  - kind='transient' → transient (短時間 retry してから deleted に倒す) */
export function useHandle(did: string | null | undefined): HandleResult {
  const [result, setResult] = useState<HandleResult>(() => {
    if (!did) return { handle: null, state: 'loading' };
    // SSR や localStorage access が throw する環境 (= 一部のブラウザ拡張)
    // でも初期 render を落とさないよう、guard を hasLocalStorage() に揃える。
    if (!hasLocalStorage()) return { handle: null, state: 'loading' };
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
    const attempt = async (retry: number) => {
      const r = await resolveHandleDetailed(did);
      if (cancelled) return;
      if (r.kind === 'ok') {
        setResult({ handle: r.handle, state: 'resolved' });
        return;
      }
      if (r.kind === 'transient' && retry > 0) {
        // 1.2s 待って 1 回だけ retry。それでも transient なら UI 上は loading→transient へ
        await new Promise((res) => setTimeout(res, 1200));
        if (cancelled) return;
        return attempt(retry - 1);
      }
      setResult({ handle: null, state: r.kind });
    };
    void attempt(1);
    return () => { cancelled = true; };
  }, [did]);

  return result;
}
