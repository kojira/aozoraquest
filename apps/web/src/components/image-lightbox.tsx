import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { PostImage } from '@/lib/post-embed';

/**
 * 投稿画像のフルスクリーンビューア。
 *
 * - ESC / 背景クリック / 閉じるボタンで閉じる
 * - 複数枚: ← → キー、左右ボタン、**横スワイプ (指追従カルーセル)** で前後移動
 * - 端まで来たら止まる (ループしない。端ではドラッグに抵抗をかける)
 * - 次/前の画像を new Image().src でプリロード
 * - body のスクロールを掴んだままにしない
 *
 * スワイプは横カルーセル方式: 全スライドを横一列に並べ translateX で動かす。
 * `touch-action: none` でブラウザの縦スクロール/パンに**ジェスチャを奪われない**ようにし、
 * touchmove で指に追従、touchend で閾値を超えたら次/前へスナップ (transition でスライドイン)。
 */
const SWIPE_THRESHOLD_RATIO = 0.18; // ビューポート幅のこの割合を超えたらページ送り
const SWIPE_THRESHOLD_MAX = 60;     // ただし最低でもこの px を超えれば送る

export function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: PostImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(initialIndex);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);

  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<'h' | 'v' | null>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const vpW = useRef(0);

  const go = useCallback(
    (delta: number) => {
      setIdx((i) => {
        const n = i + delta;
        if (n < 0 || n >= images.length) return i;
        return n;
      });
    },
    [images.length],
  );

  // keyboard + body scroll lock
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, go]);

  // 前後の画像をプリロード
  useEffect(() => {
    for (const j of [idx + 1, idx - 1]) {
      const im = images[j];
      if (im) { const pre = new Image(); pre.src = im.fullsize; }
    }
  }, [idx, images]);

  const multi = images.length > 1;
  const hasPrev = idx > 0;
  const hasNext = idx < images.length - 1;

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    startX.current = t.clientX;
    startY.current = t.clientY;
    axis.current = null;
    vpW.current = vpRef.current?.clientWidth ?? window.innerWidth;
    setDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    // 最初の十分な移動で軸を確定 (横なら以後カルーセル、縦なら無視)。
    if (axis.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      axis.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    }
    if (axis.current === 'h') {
      // 端ではドラッグに抵抗 (1/3) をかけ、これ以上めくれない感を出す。
      const atEdge = (idx === 0 && dx > 0) || (idx === images.length - 1 && dx < 0);
      setDrag(atEdge ? dx / 3 : dx);
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    setDragging(false);
    const a = axis.current;
    axis.current = null;
    if (a !== 'h') { setDrag(0); return; }
    const endX = e.changedTouches[0]?.clientX ?? startX.current;
    const dx = endX - startX.current;
    const threshold = Math.min(SWIPE_THRESHOLD_MAX, vpW.current * SWIPE_THRESHOLD_RATIO);
    if (Math.abs(dx) > threshold) go(dx < 0 ? 1 : -1);
    setDrag(0); // idx 変化 + drag 0 + transition で新しい位置へスライドイン
  }

  if (!images[idx]) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 150,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2vh 2vw',
      }}
    >
      {/* 画像エリア = 横カルーセル。touch-action:none でブラウザの縦スクロール/パンに
          スワイプを奪われないようにする (= 指追従が安定)。 */}
      <div
        ref={vpRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            height: '100%',
            transform: `translateX(calc(${-idx * 100}% + ${drag}px))`,
            transition: dragging ? 'none' : 'transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)',
            willChange: 'transform',
          }}
        >
          {images.map((im, i) => (
            <div
              key={i}
              style={{ flex: '0 0 100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <img
                src={im.fullsize}
                alt={im.alt}
                onClick={(e) => e.stopPropagation()}
                draggable={false}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  userSelect: 'none',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 下部コントロール: 親指で届く位置に。前後 ‹›・カウンタは画像の下、
          閉じる × は最下部 (画面上部まで指を伸ばさなくて済むように)。 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: '0 0 auto',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          paddingTop: 10,
          paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
          color: 'rgba(255,255,255,0.9)',
          fontSize: 13,
        }}
      >
        {images[idx]!.alt && (
          <span style={{ maxWidth: 720, textAlign: 'center', lineHeight: 1.5, padding: '0 16px' }}>{images[idx]!.alt}</span>
        )}

        {multi && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button
              type="button"
              disabled={!hasPrev}
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              aria-label="前の画像"
              style={navBtnStyle(hasPrev)}
            >
              <ChevronIcon dir="left" />
            </button>
            <span style={{ fontFamily: 'ui-monospace, monospace', minWidth: '3.5em', textAlign: 'center' }}>
              {idx + 1} / {images.length}
            </span>
            <button
              type="button"
              disabled={!hasNext}
              onClick={(e) => { e.stopPropagation(); go(1); }}
              aria-label="次の画像"
              style={navBtnStyle(hasNext)}
            >
              <ChevronIcon dir="right" />
            </button>
          </div>
        )}

        {/* 閉じる (最下部・中央) */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="閉じる"
          style={navBtnStyle(true)}
        >
          <CloseIcon />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** 前/次の丸ボタンのスタイル (有効/無効で色を出し分け)。 */
function navBtnStyle(enabled: boolean): CSSProperties {
  return {
    width: 44,
    height: 44,
    borderRadius: 22,
    border: 'none',
    background: enabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
    color: enabled ? '#fff' : 'rgba(255,255,255,0.35)',
    cursor: enabled ? 'pointer' : 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };
}

/** 閉じる × アイコン (グリフだと字形で中央がずれるので SVG で正確に中央化)。 */
function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="M6 6 18 18M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** 前/次の山形アイコン (グリフ ‹ › は字形が左右非対称で中央がずれるため SVG)。 */
function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  const d = dir === 'left' ? 'M15 5 8 12 15 19' : 'M9 5 16 12 9 19';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d={d} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
