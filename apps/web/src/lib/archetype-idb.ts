/**
 * 他ユーザーの archetype 解決結果を IndexedDB にキャッシュする。
 * `translation-idb.ts` と同じ pattern。
 *
 * 用途: TL 著者 N 人分の archetype を毎回 PDS getRecord で取り直すのを避け、
 *       リロード後すぐにバッジを表示するため。`archetype-cache.ts` の memory
 *       cache miss 時にこの IDB レイヤを引く。
 *
 * キャッシュポリシー:
 * - key: DID
 * - value: { did, archetype: Archetype | null, cachedAt }
 *   - archetype === null は「過去に PDS に問い合わせたが record が無かった」を意味する
 *     (= 未参加ユーザ)。null も cache しないと毎回 getRecord が発火するので保存する
 * - TTL: 24h (analysis レコードは数日に 1 回程度の更新が現実的)
 */

import type { Archetype } from '@aozoraquest/core';

const DB_NAME = 'aozoraquest-archetype-cache';
const DB_VERSION = 1;
const STORE = 'archetypes';
const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheRow {
  did: string;
  archetype: Archetype | null;
  cachedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'did' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      }),
  );
}

/** 24h 以内なら archetype (or null) を返す。miss / 期限切れは undefined。 */
export async function loadCachedArchetype(did: string): Promise<Archetype | null | undefined> {
  try {
    const row = await withStore<CacheRow | undefined>('readonly', (s) =>
      s.get(did) as IDBRequest<CacheRow | undefined>,
    );
    if (!row) return undefined;
    if (Date.now() - row.cachedAt > TTL_MS) return undefined;
    return row.archetype;
  } catch {
    return undefined;
  }
}

export async function saveCachedArchetype(did: string, archetype: Archetype | null): Promise<void> {
  try {
    const row: CacheRow = { did, archetype, cachedAt: Date.now() };
    await withStore('readwrite', (s) => s.put(row));
  } catch {
    /* no-op */
  }
}
