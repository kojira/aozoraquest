/**
 * タイムライン (フォロー / 共鳴 等) の直近 1 ページを IndexedDB にキャッシュする。
 * `translation-idb.ts` と同じ pattern。
 *
 * 用途: 起動時に SWR で「直近の TL を即座に出す → 並行で fresh fetch して置換」
 *       するため。`useInfiniteFeed` の `cache` prop に渡す。
 *
 * キャッシュポリシー:
 * - key: `tl:${kind}:${did}` (例: `tl:following:did:plc:xxx`)
 *   - kind = following / resonance / profile-feed-${authorDid} 等、call site が決める
 *   - 別ユーザの cache が混入しないよう DID を含める
 * - value: { items: FeedViewPost[], cachedAt }
 * - TTL: 24h (古すぎる TL を表示しないため)
 *
 * items 型は call site 側から FeedViewPost を渡してもらう。store は generic に持つ。
 */

const DB_NAME = 'aozoraquest-tl-pages';
const DB_VERSION = 1;
const STORE = 'pages';
const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheRow<T> {
  key: string;
  items: T[];
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
        db.createObjectStore(STORE, { keyPath: 'key' });
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

export async function loadCachedTLPage<T>(key: string): Promise<T[] | undefined> {
  try {
    const row = await withStore<CacheRow<T> | undefined>('readonly', (s) =>
      s.get(key) as IDBRequest<CacheRow<T> | undefined>,
    );
    if (!row) return undefined;
    if (Date.now() - row.cachedAt > TTL_MS) return undefined;
    return row.items;
  } catch {
    return undefined;
  }
}

export async function saveCachedTLPage<T>(key: string, items: T[]): Promise<void> {
  try {
    const row: CacheRow<T> = { key, items, cachedAt: Date.now() };
    await withStore('readwrite', (s) => s.put(row));
  } catch {
    /* no-op */
  }
}
