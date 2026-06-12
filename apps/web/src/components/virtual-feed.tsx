import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * 仮想スクローラ。DOM 上に存在するのは可視範囲 ± overscan のアイテムだけ。
 * 可変高に対応 (measureElement で各要素の高さを実測)。
 *
 * スクロール元は 2 モード:
 *  - 既定: ウィンドウ (ビューポート) スクロール
 *  - `scrollParentRef` 指定時: その要素内のスクロール
 *    (マルチカラム workspace の column-body 等、docs/16-multicolumn.md)
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
  /** 未指定なら window スクロール (後方互換)。指定するとその要素内スクロール。 */
  scrollParentRef?: RefObject<HTMLElement | null> | undefined;
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
    scrollParentRef,
  } = props;

  // window モードでは parentRef は offsetTop 計算用。container モードでは不要 (margin 0)。
  const parentRef = useRef<HTMLDivElement>(null);

  // ref.current は commit 後に入るので、render 中に直接読むと初回 null のまま固定される。
  // effect で state に同期して、container が入った時点で再 render させる。
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContainerEl(scrollParentRef?.current ?? null);
  });

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () =>
      containerEl ?? (typeof window === 'undefined' ? null : (document.scrollingElement as HTMLElement)),
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (i) => keyOf(items[i]!),
    // window スクロールで parentRef が描画ツリー内のどこにあるかをオフセットとして渡す。
    // container モードでは container 先頭 = リスト先頭なので 0。
    scrollMargin: containerEl ? 0 : (parentRef.current?.offsetTop ?? 0),
    measureElement: (el) => el.getBoundingClientRect().height,
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
  const scrollMargin = containerEl ? 0 : (parentRef.current?.offsetTop ?? 0);

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
