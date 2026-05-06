/**
 * 投稿の cognitive 解析結果 (Fe/Ni 等のスコア) を IndexedDB にキャッシュする。
 * `translation-idb.ts` と同じ pattern。
 *
 * 用途: TL 解析 ON ユーザがリロードする度に ONNX 推論が走り直すのを避ける。
 *       `post-cognitive.ts` の memory cache miss 時にこの IDB レイヤを引く。
 *
 * キャッシュポリシー:
 * - key: post の AT URI (post 本文は immutable なので URI = 一意 / 不変)
 * - value: { uri, scores: CognitiveScores, cachedAt }
 * - TTL: 30 日 (translation と同等で長め)
 */

import type { CognitiveScores } from '@aozoraquest/core';

const DB_NAME = 'aozoraquest-cognitive-cache';
const DB_VERSION = 1;
const STORE = 'scores';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheRow {
  uri: string;
  scores: CognitiveScores;
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
        db.createObjectStore(STORE, { keyPath: 'uri' });
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

export async function loadCachedCognitive(uri: string): Promise<CognitiveScores | undefined> {
  try {
    const row = await withStore<CacheRow | undefined>('readonly', (s) =>
      s.get(uri) as IDBRequest<CacheRow | undefined>,
    );
    if (!row) return undefined;
    if (Date.now() - row.cachedAt > TTL_MS) return undefined;
    return row.scores;
  } catch {
    return undefined;
  }
}

export async function saveCachedCognitive(uri: string, scores: CognitiveScores): Promise<void> {
  try {
    const row: CacheRow = { uri, scores, cachedAt: Date.now() };
    await withStore('readwrite', (s) => s.put(row));
  } catch {
    /* no-op */
  }
}
