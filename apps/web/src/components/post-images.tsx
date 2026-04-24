import { useState, type CSSProperties } from 'react';
import type { PostImage } from '@/lib/post-embed';
import { ImageLightbox } from './image-lightbox';

/**
 * 投稿に添付された 1〜4 枚の画像を **正方形タイル** で表示する
 * 固定幅の小さなグリッド。投稿テキストの左横に置く想定。
 *
 * レイアウト (総幅 COL_W = 140px):
 *   1 枚: 140×140 (単独)
 *   2 枚: 140×68 (2 列 × 1 行、各タイル 68×68)
 *   3 枚: 140×140 (2×2 で 1 枚分空き、各タイル 68×68)
 *   4 枚: 140×140 (2×2、各タイル 68×68)
 *
 * 画像ロードで高さがジャンプしないよう `aspect-ratio: 1 / 1` で
 * タイル形状を CSS 側で確定させる。画像本体は `object-fit: cover`。
 */
const COL_W = 140;
const GAP = 2;

function gridStyle(n: 1 | 2 | 3 | 4): CSSProperties {
  const cols = n === 1 ? 1 : 2;
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gap: GAP,
    width: COL_W,
    flexShrink: 0,
  };
}

export function PostImages({ images }: { images: PostImage[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (images.length === 0) return null;
  const slice = images.slice(0, 4);
  const n = slice.length as 1 | 2 | 3 | 4;

  return (
    <>
      <div style={gridStyle(n)}>
        {slice.map((img, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpenIdx(i)}
            style={{
              all: 'unset',
              cursor: 'zoom-in',
              display: 'block',
              width: '100%',
              aspectRatio: '1 / 1',
              overflow: 'hidden',
              borderRadius: 4,
              background: '#000',
            }}
          >
            <img
              src={img.thumb}
              alt={img.alt}
              loading="lazy"
              decoding="async"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </button>
        ))}
      </div>
      {openIdx !== null && (
        <ImageLightbox images={slice} initialIndex={openIdx} onClose={() => setOpenIdx(null)} />
      )}
    </>
  );
}
