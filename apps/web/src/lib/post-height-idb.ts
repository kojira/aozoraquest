/**
 * VirtualFeed の行の実測高さを IndexedDB に永続化する (`tl-cache-idb.ts` と同じ pattern)。
 *
 * 用途: 可変高仮想スクロールで、画面外にアンマウントされた行が再マウントする際に
 * estimateSize=180px からやり直すと、実測との差ぶん totalSize / translateY が補正され
 * スクロール位置が数十 px ズレる。実測高さを覚えておき再マウント時の推定に使えばズレない。
 * in-memory だけだとリロード/カラム更新で消えるため、ストレージにも保存して初回スクロール
 * から安定させる。
 *
 * キャッシュポリシー:
 * - namespace (key) ごとに 1 行。namespace = feed の cache key (例 `tl:following:did:plc:xxx`)
 * - value: { key: ns, heights: { [uri]: { w, h } }, cachedAt }
 *   - **w (描画幅) を一緒に保存**。高さは幅で変わる (本文の折り返し) ため、読む側は
 *     現在の幅と一致したエントリだけを使う (別端末/回転/カラムリサイズで誤用しない)。
 * - TTL: 7日 (古い高さは破棄)。1 namespace あたり最大 MAX_ENTRIES でプルーン。
 */

const DB_NAME = 'aozoraquest-post-heights';
const DB_VERSION = 1;
const STORE = 'heights';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 1 namespace に保存する uri の上限 (超えたら古い順に捨てる)。 */
export const MAX_HEIGHT_ENTRIES = 1500;

export interface HeightEntry { w: number; h: number }
export type HeightMap = Record<string, HeightEntry>;

interface CacheRow {
  key: string;
  heights: HeightMap;
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

/** namespace の保存済み高さを読む (TTL 切れは無視)。失敗時は空。 */
export async function loadHeights(ns: string): Promise<HeightMap> {
  try {
    const row = await withStore<CacheRow | undefined>('readonly', (s) =>
      s.get(ns) as IDBRequest<CacheRow | undefined>,
    );
    if (!row || Date.now() - row.cachedAt > TTL_MS) return {};
    return row.heights ?? {};
  } catch {
    return {};
  }
}

/** namespace の高さ map をまるごと保存 (呼び出し側でデバウンスすること)。 */
export async function saveHeights(ns: string, heights: HeightMap): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put({ key: ns, heights, cachedAt: Date.now() } satisfies CacheRow));
  } catch {
    /* no-op */
  }
}
