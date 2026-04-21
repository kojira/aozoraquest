import { type ReactNode, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * ウィンドウ (ビューポート) を仮想スクローラとして使う。
 * DOM 上に存在するのは可視範囲 ± overscan のアイテムだけ。
 * 可変高に対応 (measureElement で各要素の高さを実測)。
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
  } = props;

  // window スクロールを使う。parentRef は offsetTop 計算用のダミー。
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => (typeof window === 'undefined' ? null : (document.scrollingElement as HTMLElement)),
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (i) => keyOf(items[i]!),
    // window スクロールで parentRef が描画ツリー内のどこにあるかをオフセットとして渡す
    scrollMargin: parentRef.current?.offsetTop ?? 0,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // onEndReached: 末尾からの距離で発火
  useEffect(() => {
    if (!onEndReached) return;
    const check = () => {
      const scrollEl = document.scrollingElement;
      if (!scrollEl) return;
      const remaining = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (remaining < endReachedThreshold) onEndReached();
    };
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    // 初回の描画直後にも 1 度呼ぶ (items が少ないときに即時 loadMore)
    check();
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [onEndReached, endReachedThreshold, items.length]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const scrollMargin = parentRef.current?.offsetTop ?? 0;

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
