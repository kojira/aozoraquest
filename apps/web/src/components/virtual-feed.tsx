import { type ReactNode, useEffect } from 'react';

/**
 * フィードのリスト描画。**仮想化 (transform で画面外行をアンマウント) はしない**。
 *
 * 全行を通常フローで DOM に保持し、画面外行は CSS `content-visibility: auto` で
 * ブラウザに描画/レイアウト/デコードをスキップさせる。これは Bluesky 公式 web
 * クライアント (社内 List.web.tsx = 全行を normal flow で保持) と同じ方針で、さらに
 * content-visibility でレンダリングコストを抑えたもの。
 *
 * これにより過去の transform 仮想化 (tanstack) で起きていた問題が原理的に消える:
 *  - 上スクロールで位置がズレる … 通常フロー + ブラウザの overflow-anchor が効く
 *  - 画面外行の再マウントで画像を再リクエスト … <img> が DOM に残るので再取得しない
 *  - 推定 vs 実測の高さ帳尻ズレ / スクロール震え … 再計測自体が無い
 * `contain-intrinsic-size: auto <推定>` で、ブラウザが一度描画した実寸を記憶し、
 * スキップ中もその高さでスクロールバー/位置を安定させる (= height キャッシュ不要)。
 *
 * メモリ: 行 DOM は残るが (1 投稿 ~30-45 ノードと軽量)、画面外は content-visibility が
 * 描画・画像デコードをスキップするのでデコード画像メモリは可視付近に有界。
 *
 * スクロール元は 2 モード:
 *  - 既定: ウィンドウ (ビューポート) スクロール
 *  - `scrollParent` 指定時: その要素内のスクロール (マルチカラム column-body 等)
 */
export interface VirtualFeedProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  /** content-visibility スキップ中の行のプレースホルダ高さ (実寸は描画後ブラウザが記憶)。 */
  estimateSize?: number;
  /** @deprecated 仮想化していないので未使用 (後方互換のため受けるだけ)。 */
  overscan?: number;
  /** リストの末尾近くに来たら呼ばれる (次ページ読み込みトリガー) */
  onEndReached?: (() => void) | undefined;
  /** onEndReached を発火させるしきい値 (px) */
  endReachedThreshold?: number;
  renderItem: (item: T, index: number) => ReactNode;
  /** 末尾に置くフッター (読み込み中表示など) */
  footer?: ReactNode;
  /** 未指定 / null なら window スクロール。指定するとその要素内スクロール (onEndReached 用)。 */
  scrollParent?: HTMLElement | null | undefined;
  /** @deprecated content-visibility が native に高さを記憶するので不要 (後方互換)。 */
  heightCacheKey?: string | undefined;
}

export function VirtualFeed<T>(props: VirtualFeedProps<T>) {
  const {
    items,
    keyOf,
    estimateSize = 400,
    onEndReached,
    endReachedThreshold = 800,
    renderItem,
    footer,
    scrollParent,
  } = props;

  const containerEl = scrollParent ?? null;

  // onEndReached: 末尾からの距離で発火 (スクロール / リサイズ / 件数変化時)。
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

  return (
    <div>
      {items.map((item, i) => (
        <div
          key={keyOf(item)}
          style={{
            // 画面外行は描画/レイアウト/画像デコードをスキップ。実寸は描画後にブラウザが記憶。
            contentVisibility: 'auto',
            // auto = 一度描画した実寸を記憶し、スキップ中もそれでスペースを確保 (位置安定)。
            // 幅は通常フローで決まるので block (高さ) 側だけ推定を与える。
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
