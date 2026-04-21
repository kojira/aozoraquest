/**
 * カーソル型ページングの汎用フック。
 *
 * - items は append-only で伸びる (データ配列は成長する)
 * - DOM 側の制約は VirtualFeed が担当する
 * - deps が変わると state をリセットして再フェッチ
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface InfiniteFeedPage<T> {
  items: T[];
  cursor?: string;
}

export interface UseInfiniteFeedOptions<T> {
  fetchPage: (cursor?: string) => Promise<InfiniteFeedPage<T>>;
  /** dedupe に使うキー抽出関数 */
  keyOf: (item: T) => string;
  /** 依存値が変わるとリセット */
  deps: ReadonlyArray<unknown>;
  /** 有効化フラグ (false の間は何もしない) */
  enabled?: boolean;
}

export interface InfiniteFeedState<T> {
  items: T[];
  loading: boolean;
  err: string | null;
  done: boolean;
  loadMore: () => void;
  /** 先頭から再読み込み (投稿直後のリフレッシュ用など) */
  refresh: () => void;
}

export function useInfiniteFeed<T>(opts: UseInfiniteFeedOptions<T>): InfiniteFeedState<T> {
  const { fetchPage, keyOf, deps, enabled = true } = opts;

  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const cursorRef = useRef<string | undefined>(undefined);
  const inflight = useRef(false);
  const doneRef = useRef(false);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;

  const load = useCallback(async (resetting: boolean) => {
    if (inflight.current) return;
    if (!enabled) return;
    if (!resetting && doneRef.current) return;
    inflight.current = true;
    setLoading(true);
    setErr(null);
    try {
      const nextCursor = resetting ? undefined : cursorRef.current;
      const page = await fetchPageRef.current(nextCursor);
      setItems((prev) => {
        const base = resetting ? [] : prev;
        const seen = new Set(base.map((x) => keyOfRef.current(x)));
        const merged = [...base];
        for (const it of page.items) {
          const k = keyOfRef.current(it);
          if (!seen.has(k)) {
            merged.push(it);
            seen.add(k);
          }
        }
        return merged;
      });
      cursorRef.current = page.cursor;
      if (!page.cursor || page.items.length === 0) {
        doneRef.current = true;
        setDone(true);
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, [enabled]);

  // deps 変化でリセット
  useEffect(() => {
    setItems([]);
    cursorRef.current = undefined;
    doneRef.current = false;
    setDone(false);
    setErr(null);
    if (enabled) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  const loadMore = useCallback(() => {
    if (!inflight.current && !doneRef.current) void load(false);
  }, [load]);

  /**
   * 先頭ページを取得して既存と「マージ」する。
   * 画面から投稿が一瞬消えるのを避けるため、items は clear せず、
   * 新しい投稿だけを先頭に挿入する。既存のカーソル (末尾) はそのまま維持。
   */
  const refresh = useCallback(() => {
    if (inflight.current || !enabled) return;
    inflight.current = true;
    setLoading(true);
    setErr(null);
    fetchPageRef.current(undefined)
      .then((page) => {
        // page.items 自体に重複キーが含まれる可能性がある (Bluesky の edge case) ので
        // まず new 内で dedupe、その後 prev から new に含まれる key を除外。
        setItems((prev) => {
          const seen = new Set<string>();
          const uniqueNew: T[] = [];
          for (const it of page.items) {
            const k = keyOfRef.current(it);
            if (!seen.has(k)) {
              seen.add(k);
              uniqueNew.push(it);
            }
          }
          const kept = prev.filter((x) => !seen.has(keyOfRef.current(x)));
          return [...uniqueNew, ...kept];
        });
      })
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => {
        inflight.current = false;
        setLoading(false);
      });
  }, [enabled]);

  return { items, loading, err, done, loadMore, refresh };
}
