/**
 * 投稿の日本語翻訳をキャッシュする IndexedDB ラッパ。analysis-idb.ts の
 * パターンを踏襲。
 *
 * キャッシュポリシー:
 * - key: 投稿の AT URI (投稿は immutable なので URI = 一意)
 * - value: { translatedText, cachedAt }
 * - TTL: 30 日 (翻訳結果は変わらないので長め)
 */

const DB_NAME = 'aozoraquest-translations';
const DB_VERSION = 1;
const STORE = 'post-translations';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheRow {
  uri: string;
  translatedText: string;
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

export async function loadCachedTranslation(uri: string): Promise<string | undefined> {
  try {
    const row = await withStore<CacheRow | undefined>('readonly', (s) =>
      s.get(uri) as IDBRequest<CacheRow | undefined>,
    );
    if (!row) return undefined;
    if (Date.now() - row.cachedAt > TTL_MS) return undefined;
    return row.translatedText;
  } catch {
    return undefined;
  }
}

export async function saveCachedTranslation(uri: string, translatedText: string): Promise<void> {
  try {
    const row: CacheRow = { uri, translatedText, cachedAt: Date.now() };
    await withStore('readwrite', (s) => s.put(row));
  } catch {
    /* no-op */
  }
}
