/**
 * 裏診断 (ONNX で計算した他ユーザーの DiagnosisResult) を IndexedDB に
 * 永続保存する軽量ラッパ。ブラウザを閉じても保持し、再訪問時は即時ロード。
 *
 * キャッシュポリシー:
 * - key: did (ATProto did のまま)
 * - value: { analysis: DiagnosisResult, cachedAt: number (ms) }
 * - TTL: 7 日 (これを超えたら再診断)
 * - analysis が null の場合もキャッシュする (投稿不足などで診断不能だった did
 *   を 7 日間は再トライしない)
 */

import type { DiagnosisResult } from '@aozoraquest/core';

const DB_NAME = 'aozoraquest';
const DB_VERSION = 1;
const STORE = 'follow-analysis';
export const IDB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheRow {
  did: string;
  analysis: DiagnosisResult | null;
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

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  }));
}

/** cache が TTL 内ならそれを返す。期限切れや未保存なら undefined。 */
export async function loadCachedAnalysis(did: string): Promise<DiagnosisResult | null | undefined> {
  try {
    const row = await withStore<CacheRow | undefined>('readonly', (s) => s.get(did) as IDBRequest<CacheRow | undefined>);
    if (!row) return undefined;
    if (Date.now() - row.cachedAt > IDB_TTL_MS) return undefined;
    return row.analysis;
  } catch {
    return undefined;
  }
}

/** 診断結果を保存する (null 可: 投稿不足で診断不能だった場合もキャッシュする)。 */
export async function saveCachedAnalysis(did: string, analysis: DiagnosisResult | null): Promise<void> {
  try {
    const row: CacheRow = { did, analysis, cachedAt: Date.now() };
    await withStore('readwrite', (s) => s.put(row));
  } catch {
    // IDB 書き込み失敗は致命的ではない (メモリキャッシュで続行)
  }
}

/** 開発時やデバッグ用: 全キャッシュを削除。 */
export async function clearCachedAnalyses(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.clear());
  } catch {
    /* no-op */
  }
}
