import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { loadHeights, saveHeights, MAX_HEIGHT_ENTRIES, type HeightEntry } from '@/lib/post-height-idb';

/**
 * 仮想スクローラ。DOM 上に存在するのは可視範囲 ± overscan のアイテムだけ。
 * 可変高に対応 (measureElement で各要素の高さを実測)。
 *
 * スクロール元は 2 モード:
 *  - 既定: ウィンドウ (ビューポート) スクロール
 *  - `scrollParent` 指定時: その要素内のスクロール
 *    (マルチカラム workspace の column-body 等、docs/16-multicolumn.md)
 *
 * scrollParent は RefObject ではなく要素そのものを受け取る。利用側は
 * `useState<HTMLElement | null>` + callback ref で要素を管理して渡すこと
 * (要素の出現・差し替えが props 変化として自然に再 render を起こすため)。
 *
 * data 配列自体は成長するため真に無限な memory bound ではないが、
 * DOM 側は件数によらず一定、これが体感メモリの主因なのでこれでほぼ解決する。
 */
export interface VirtualFeedProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  estimateSize?: number;
  overscan?: number;
  /** リストの末尾近くに来たら呼ばれる (次ページ読み込みトリガー) */
  onEndReached?: (() => void) | undefined;
  /** onEndReached を発火させるしきい値 (px) */
  endReachedThreshold?: number;
  renderItem: (item: T, index: number) => ReactNode;
  /** 末尾に置くフッター (読み込み中表示など) */
  footer?: ReactNode;
  /** 未指定 / null なら window スクロール (後方互換)。指定するとその要素内スクロール。 */
  scrollParent?: HTMLElement | null | undefined;
  /** 指定すると、行の実測高さをこの namespace で IndexedDB に永続化し、再マウント/リロード後の
   *  estimateSize に使う (スクロール位置ズレ防止)。通常は feed の cache key を渡す。 */
  heightCacheKey?: string | undefined;
}

export function VirtualFeed<T>(props: VirtualFeedProps<T>) {
  const {
    items,
    keyOf,
    estimateSize = 180,
    overscan = 6,
    onEndReached,
    endReachedThreshold = 800,
    renderItem,
    footer,
    scrollParent,
    heightCacheKey,
  } = props;

  // window モードでは parentRef は offsetTop 計算用。
  const parentRef = useRef<HTMLDivElement>(null);
  const containerEl = scrollParent ?? null;

  // 一度実測した行の高さを keyOf(uri) → { w(描画幅), h } で記憶する。再マウント時
  // (= 下に古い投稿までスクロール → 最新へ戻る) に 180px 推定からやり直すと、実測との差ぶん
  // totalSize と各行 translateY が補正され、スクロール位置が数十 px ズレて「引っかかる」。
  // estimateSize がこのキャッシュ (幅一致時のみ) を引くことで再マウント行は最初から実高さで
  // 配置され帳尻ズレが起きない。heightCacheKey 指定時は IndexedDB にも保存し、リロード/カラム
  // 更新後の初回スクロールから安定させる (post-height-idb.ts)。
  const measuredRef = useRef<Map<string, HeightEntry>>(new Map());
  // 現在の描画幅 (高さは幅依存なので、別幅のキャッシュは使わない)。
  const widthRef = useRef(0);
  // hydrate 完了などで estimateSize の結果を再評価させるための強制再描画。
  const [, forceTick] = useState(0);

  // 起動時に永続化済み高さを hydrate (heightCacheKey 指定時のみ)。async だが estimateSize は
  // Map を sync 参照するので、hydrate 完了後の再描画で反映される。
  useEffect(() => {
    if (!heightCacheKey) return;
    let cancelled = false;
    void loadHeights(heightCacheKey).then((map) => {
      if (cancelled) return;
      for (const [k, v] of Object.entries(map)) measuredRef.current.set(k, v);
      forceTick((t) => t + 1); // hydrate を見た目に反映
    });
    return () => { cancelled = true; };
  }, [heightCacheKey]);

  // 測定結果の IndexedDB 書き込みをデバウンス + 上限プルーン。
  const saveTimerRef = useRef<number | null>(null);
  function scheduleHeightSave() {
    if (!heightCacheKey) return;
    if (saveTimerRef.current) return;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const entries = Array.from(measuredRef.current.entries());
      // 上限超過分は古い側 (Map の挿入順で前方) から捨てる
      const trimmed = entries.length > MAX_HEIGHT_ENTRIES
        ? entries.slice(entries.length - MAX_HEIGHT_ENTRIES)
        : entries;
      void saveHeights(heightCacheKey, Object.fromEntries(trimmed));
    }, 1500);
  }
  // unmount 時に保留中の保存タイマを破棄 (リーク防止)。
  useEffect(() => () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); }, []);

  // container モードの scrollMargin: リスト先頭の container 内オフセットを実測する。
  // カラム内ではリストの上に HomeSummary 等のコンテンツが挟まることがあり、
  // 0 固定だと visible range がずれて上端に空白行が出る (レビュー指摘)。
  // 上部コンテンツの高さ変化 (レーダーの遅延描画等) に ResizeObserver で追従。
  const [containerMargin, setContainerMargin] = useState(0);
  useEffect(() => {
    if (!containerEl) return;
    const measure = () => {
      const listEl = parentRef.current;
      if (!listEl) return;
      const m =
        listEl.getBoundingClientRect().top -
        containerEl.getBoundingClientRect().top +
        containerEl.scrollTop;
      setContainerMargin(Math.max(0, Math.round(m)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // ResizeObserver のコールバックを rAF でデバウンスする。同一フレーム内の
    // 複数発火を 1 回に畳み込み、measure → setState → reflow → 再発火 の
    // タイトループ ("ResizeObserver loop" / スクロール震え) を断つ。値が変わら
    // なければ setContainerMargin は React がバイパスするので再 render も起きない。
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(containerEl);
    const above = parentRef.current?.parentElement;
    if (above) ro.observe(above);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [containerEl]);

  // 既知の制約 (旧実装から同じ): window モードの scrollMargin は render 中に
  // parentRef.current を読むため、初回 render では 0 のまま確定する。
  // リストがページ先頭近くに置かれる現状のレイアウトでは実害がないので据え置き。
  const scrollMargin = containerEl ? containerMargin : (parentRef.current?.offsetTop ?? 0);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () =>
      containerEl ?? (typeof window === 'undefined' ? null : (document.scrollingElement as HTMLElement)),
    // 未測定行は既定推定。一度測った行は記憶した実高さを初期値に使う (再マウントの帳尻ズレ防止)。
    // ただし高さは描画幅で変わるので、保存時と同じ幅のときだけキャッシュを使う。
    estimateSize: (i) => {
      const it = items[i];
      const c = it ? measuredRef.current.get(keyOf(it)) : undefined;
      const w = Math.round(parentRef.current?.clientWidth ?? 0);
      return (c && c.w === w) ? c.h : estimateSize;
    },
    overscan,
    getItemKey: (i) => keyOf(items[i]!),
    // window スクロールで parentRef が描画ツリー内のどこにあるかをオフセットとして渡す。
    // container モードでは container 先頭 = リスト先頭なので 0
    // (column 内にヘッダー等を挟む場合は利用側で要再考)。
    scrollMargin,
    // 実測高さを整数に丸める。getBoundingClientRect().height は小数を返し、
    // 行の高さが 0.x px 単位で揺れると translateY 補正 → 再測定 → … と
    // サブピクセルのフィードバックループ (スクロール震え/shimmer) を起こしうる。
    // 丸めることでこの振動源を断つ (体感の高さ精度には影響しない)。
    // 同時に keyOf(uri) → { 幅, 高さ } を記憶し (再挿入で recency 順を保つ)、
    // 再マウント時の estimateSize と IndexedDB 永続化に使う。
    measureElement: (el) => {
      const h = Math.round(el.getBoundingClientRect().height);
      const w = Math.round((el as HTMLElement).offsetWidth) || widthRef.current;
      if (w > 0) widthRef.current = w;
      const idx = Number((el as HTMLElement).getAttribute('data-index'));
      if (!Number.isNaN(idx) && items[idx]) {
        const key = keyOf(items[idx]!);
        measuredRef.current.delete(key);
        measuredRef.current.set(key, { w, h });
        scheduleHeightSave();
      }
      return h;
    },
  });

  // onEndReached: 末尾からの距離で発火
  useEffect(() => {
    if (!onEndReached) return;
    const check = () => {
      const scrollEl: Element | null = containerEl ?? document.scrollingElement;
      if (!scrollEl) return;
      const remaining = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (remaining < endReachedThreshold) onEndReached();
    };
    // scroll イベントは bubbling しないので、container モードでは container 自身に貼る
    const target: EventTarget = containerEl ?? window;
    target.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    // 初回の描画直後にも 1 度呼ぶ (items が少ないときに即時 loadMore)
    check();
    return () => {
      target.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [onEndReached, endReachedThreshold, items.length, containerEl]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div ref={parentRef} style={{ position: 'relative' }}>
      <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
        {virtualItems.map((vItem) => {
          const item = items[vItem.index]!;
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${vItem.start - scrollMargin}px)`,
              }}
            >
              {renderItem(item, vItem.index)}
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}
