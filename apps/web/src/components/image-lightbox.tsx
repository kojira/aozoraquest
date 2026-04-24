import { useCallback, useEffect, useRef, useState } from 'react';
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
      {/* 閉じる */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="閉じる"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 40,
          height: 40,
          borderRadius: 20,
          border: 'none',
          background: 'rgba(255,255,255,0.15)',
          color: '#fff',
          fontSize: 22,
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        ×
      </button>

      {/* 左 */}
      {multi && (
        <button
          type="button"
          disabled={!hasPrev}
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          aria-label="前の画像"
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 44,
            height: 44,
            borderRadius: 22,
            border: 'none',
            background: hasPrev ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
            color: hasPrev ? '#fff' : 'rgba(255,255,255,0.35)',
            fontSize: 24,
            cursor: hasPrev ? 'pointer' : 'default',
          }}
        >
          ‹
        </button>
      )}

      {/* 画像 */}
      <img
        src={current.fullsize}
        alt={current.alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '92vw',
          maxHeight: '84vh',
          objectFit: 'contain',
          userSelect: 'none',
        }}
      />

      {/* 右 */}
      {multi && (
        <button
          type="button"
          disabled={!hasNext}
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          aria-label="次の画像"
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 44,
            height: 44,
            borderRadius: 22,
            border: 'none',
            background: hasNext ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
            color: hasNext ? '#fff' : 'rgba(255,255,255,0.35)',
            fontSize: 24,
            cursor: hasNext ? 'pointer' : 'default',
          }}
        >
          ›
        </button>
      )}

      {/* カウンタ + alt */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          bottom: 16,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          padding: '0 16px',
          color: 'rgba(255,255,255,0.9)',
          fontSize: 13,
          pointerEvents: 'none',
        }}
      >
        {multi && (
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>
            {idx + 1} / {images.length}
          </span>
        )}
        {current.alt && (
          <span style={{ maxWidth: 720, textAlign: 'center', lineHeight: 1.5 }}>{current.alt}</span>
        )}
      </div>
    </div>,
    document.body,
  );
}
