import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * フィードのリスト描画。**デバイスで描画方式を出し分ける**:
 *
 *  - スマホ/タブレット (タッチ主体): `VirtualizedFeed` = tanstack の transform 仮想化。
 *    画面外行をアンマウントして DOM/デコード画像を可視範囲に限定する **省メモリ**方式。
 *    モバイルは iOS Safari のメモリ上限が厳しく、上スクロールの微小なズレも気になりにくい。
 *  - PC (マウス主体): `FlowFeed` = 全行を通常フローで DOM 保持 + CSS `content-visibility:auto`。
 *    Bluesky 公式 web (社内 List.web.tsx) と同じ「行を捨てない」方式で、上スクロールの
 *    位置ズレも最新へ戻る際の画像再リクエストも起きない。PC はメモリに余裕がある一方
 *    ズレが目立つため、こちらを使う。
 *
 * scrollParent は RefObject ではなく要素そのものを受け取る (column-body 等)。
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
}

/** タッチ主体 (スマホ/タブレット) か。primary pointer が coarse なら true。 */
function useIsTouchPrimary(): boolean {
  const [touch, setTouch] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia
      ? window.matchMedia('(pointer: coarse)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => setTouch(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return touch;
}

export function VirtualFeed<T>(props: VirtualFeedProps<T>) {
  const touch = useIsTouchPrimary();
  // 子コンポーネントを切り替える (各自のフックは無条件呼び出し = Rules of Hooks 準拠)。
  return touch ? <VirtualizedFeed {...props} /> : <FlowFeed {...props} />;
}

// ─── PC: 通常フロー + content-visibility (Bluesky 流。ズレ/再リクエストなし) ───

function FlowFeed<T>({
  items,
  keyOf,
  estimateSize = 400,
  onEndReached,
  endReachedThreshold = 800,
  renderItem,
  footer,
  scrollParent,
}: VirtualFeedProps<T>) {
  const containerEl = scrollParent ?? null;

  useEffect(() => {
    if (!onEndReached) return;
    const check = () => {
      const scrollEl: Element | null = containerEl ?? document.scrollingElement;
      if (!scrollEl) return;
      const remaining = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (remaining < endReachedThreshold) onEndReached();
    };
    const target: EventTarget = containerEl ?? window;
    target.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    check();
    return () => {
      target.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [onEndReached, endReachedThreshold, items.length, containerEl]);

  return (
    <div>
      {items.map((item, i) => (
        <div
          key={keyOf(item)}
          style={{
            // 画面外行は描画/レイアウト/画像デコードをスキップ。<img> は DOM に残るので
            // 上スクロールで再取得しない。auto = 一度描画した実寸を記憶しスペースを確保。
            contentVisibility: 'auto',
            containIntrinsicSize: `auto ${estimateSize}px`,
          } as React.CSSProperties}
        >
          {renderItem(item, i)}
        </div>
      ))}
      {footer}
    </div>
  );
}

// ─── スマホ: tanstack transform 仮想化 (省メモリ。画面外行はアンマウント) ───

function VirtualizedFeed<T>({
  items,
  keyOf,
  estimateSize = 180,
  overscan = 6,
  onEndReached,
  endReachedThreshold = 800,
  renderItem,
  footer,
  scrollParent,
}: VirtualFeedProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const containerEl = scrollParent ?? null;

  // container モードの scrollMargin: リスト先頭の container 内オフセットを実測する。
  // 上部コンテンツ (HomeSummary 等) の高さ変化に ResizeObserver で追従。
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
    // ResizeObserver のコールバックを rAF でデバウンス (ResizeObserver loop / 震え対策)。
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

  const scrollMargin = containerEl ? containerMargin : (parentRef.current?.offsetTop ?? 0);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () =>
      containerEl ?? (typeof window === 'undefined' ? null : (document.scrollingElement as HTMLElement)),
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (i) => keyOf(items[i]!),
    scrollMargin,
    // 実測高さを整数に丸める (サブピクセルのフィードバックループ = スクロール震え対策)。
    measureElement: (el) => Math.round(el.getBoundingClientRect().height),
  });

  useEffect(() => {
    if (!onEndReached) return;
    const check = () => {
      const scrollEl: Element | null = containerEl ?? document.scrollingElement;
      if (!scrollEl) return;
      const remaining = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (remaining < endReachedThreshold) onEndReached();
    };
    const target: EventTarget = containerEl ?? window;
    target.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
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
