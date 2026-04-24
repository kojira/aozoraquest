import { useState, type CSSProperties } from 'react';
import type { PostImage } from '@/lib/post-embed';
import { ImageLightbox } from './image-lightbox';

/**
 * 投稿に添付された 1〜4 枚の画像を固定高 (180px) のグリッドで表示。
 * 添付が 0 枚 or 5 枚以上なら 4 枚まで描画 (Bluesky の最大が 4 だが念のため)。
 *
 * 「画像ロードでレイアウトがジャンプしない」を最優先にするため、高さは
 * 画像 aspectRatio に依らず常に 180px。画像自体は object-fit: cover。
 * フル解像度はクリックで開くライトボックス側に任せる。
 */
const GRID_HEIGHT = 180;
const GAP = 2;

function layoutStyle(n: 1 | 2 | 3 | 4): CSSProperties {
  switch (n) {
    case 1:
      return {
        display: 'grid',
        gridTemplateColumns: '1fr',
        gridTemplateRows: `${GRID_HEIGHT}px`,
      };
    case 2:
      return {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: `${GRID_HEIGHT}px`,
      };
    case 3:
      return {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: `1fr 1fr`,
        gridTemplateAreas: `'a b' 'a c'`,
        height: GRID_HEIGHT,
      };
    case 4:
      return {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: `1fr 1fr`,
        height: GRID_HEIGHT,
      };
  }
}

function tileArea(n: 1 | 2 | 3 | 4, i: number): string | undefined {
  if (n === 3) return ['a', 'b', 'c'][i];
  return undefined;
}

export function PostImages({ images }: { images: PostImage[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (images.length === 0) return null;
  const slice = images.slice(0, 4);
  const n = slice.length as 1 | 2 | 3 | 4;

  return (
    <>
      <div
        style={{
          marginTop: '0.5em',
          borderRadius: 6,
          overflow: 'hidden',
          gap: GAP,
          ...layoutStyle(n),
        }}
      >
        {slice.map((img, i) => {
          const area = tileArea(n, i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpenIdx(i)}
              style={{
                all: 'unset',
                cursor: 'zoom-in',
                display: 'block',
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                background: '#000',
                ...(area ? { gridArea: area } : {}),
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
          );
        })}
      </div>
      {openIdx !== null && (
        <ImageLightbox images={slice} initialIndex={openIdx} onClose={() => setOpenIdx(null)} />
      )}
    </>
  );
}
