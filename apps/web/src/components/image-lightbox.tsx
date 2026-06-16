import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { PostImage } from '@/lib/post-embed';

/**
 * 投稿画像のフルスクリーンビューア。
 *
 * - ESC / 背景クリック / 閉じるボタンで閉じる
 * - 複数枚: ← → キー、左右ボタン、スワイプで前後移動
 * - 端まで来たら止まる (ループしない)
 * - 次の画像を new Image().src でプリロード
 * - body のスクロールを掴んだままにしない
 */
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
  const touchStartX = useRef<number | null>(null);

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

  // 次の画像をプリロード
  useEffect(() => {
    const next = images[idx + 1];
    if (next) {
      const img = new Image();
      img.src = next.fullsize;
    }
    const prev = images[idx - 1];
    if (prev) {
      const img = new Image();
      img.src = prev.fullsize;
    }
  }, [idx, images]);

  const current = images[idx];
  if (!current) return null;

  const hasPrev = idx > 0;
  const hasNext = idx < images.length - 1;
  const multi = images.length > 1;

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
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const startX = touchStartX.current;
        touchStartX.current = null;
        if (startX === null) return;
        const endX = e.changedTouches[0]?.clientX ?? startX;
        const dx = endX - startX;
        if (Math.abs(dx) < 50) return;
        if (dx < 0) go(1);
        else go(-1);
      }}
    >
      {/* 画像エリア (残りの高さいっぱい。ボタンは画像に重ねない) */}
      <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img
          src={current.fullsize}
          alt={current.alt}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
          }}
        />
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
        {current.alt && (
          <span style={{ maxWidth: 720, textAlign: 'center', lineHeight: 1.5, padding: '0 16px' }}>{current.alt}</span>
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
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            border: 'none',
            background: 'rgba(255,255,255,0.15)',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
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
