import { useState, type CSSProperties, type ReactNode } from 'react';
import type { PostImage } from '@/lib/post-embed';
import { ImageLightbox } from './image-lightbox';

/**
 * 投稿に添付された 1〜4 枚の画像を **X (Twitter) 風のフル幅グリッド**で表示する。
 * 枚数でレイアウトが変わる:
 *   1 枚: 画像の自然比 (縦長〜横長にクランプ) で 1 枚。
 *   2 枚: 左右 2 分割。
 *   3 枚: 左 1 枚を縦長 + 右に 2 枚を縦積み。
 *   4 枚: 2×2。
 *
 * 各グリッドは `aspect-ratio` で形を CSS 側に確定させるので、画像ロードで高さが
 * ジャンプしない (仮想スクロールの帳尻ズレも防ぐ)。画像本体は object-fit: cover。
 * 外周だけ角丸 (overflow:hidden)、セル間は 2px gap。
 */
const GAP = 2;
// DESIGN.md (Shapes): 角丸は 8px 上限。X 風でも世界観に合わせ 8px に収める。
const RADIUS = 8;
/** 1 枚表示の最大高さ (縦長画像が極端に縦に伸びないようキャップ)。 */
const SINGLE_MAX_H = 510;
// PC のカラム幅は最大 760px までドラッグ可能 (COLUMN_MAX_WIDTH)。画像がそのまま追従して
// 巨大化しないよう、グリッド全体の最大幅もキャップする (X の本文カラム幅相当)。
const MAX_W = 510;

/** 1 枚画像の表示アスペクト比 (= width/height)。自然比を縦長 0.75〜横長 1.78 にクランプ。 */
function singleAspect(img: PostImage): number {
  const ar = img.aspectRatio;
  if (!ar || ar.width <= 0 || ar.height <= 0) return 16 / 9;
  const r = ar.width / ar.height;
  return Math.max(0.75, Math.min(16 / 9, r));
}

export function PostImages({ images }: { images: PostImage[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (images.length === 0) return null;
  const slice = images.slice(0, 4);
  const n = slice.length;

  const cell = (i: number, extra?: CSSProperties) => {
    const img = slice[i]!;
    return (
      <button
        key={i}
        type="button"
        onClick={() => setOpenIdx(i)}
        style={{
          // all:unset は使わない (global の button:focus-visible アウトラインを潰すため)。
          // 必要なリセットだけ明示し、フォーカスリング (a11y) は global ルールに任せる。
          border: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          cursor: 'zoom-in',
          display: 'block',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: '#000',
          ...extra,
        }}
      >
        <img
          src={img.thumb}
          alt={img.alt}
          loading="lazy"
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </button>
    );
  };

  let containerStyle: CSSProperties;
  let inner: ReactNode;

  if (n === 1) {
    containerStyle = { aspectRatio: String(singleAspect(slice[0]!)), maxHeight: SINGLE_MAX_H };
    inner = cell(0);
  } else if (n === 2) {
    containerStyle = { aspectRatio: '16 / 9', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: GAP };
    inner = (<>{cell(0)}{cell(1)}</>);
  } else if (n === 3) {
    containerStyle = {
      aspectRatio: '16 / 9',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: GAP,
    };
    // 左 1 枚を 2 行ぶん (縦長) + 右に 2 枚を縦積み
    inner = (<>{cell(0, { gridRow: '1 / 3', height: '100%' })}{cell(1)}{cell(2)}</>);
  } else {
    containerStyle = {
      aspectRatio: '16 / 9',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: GAP,
    };
    inner = (<>{cell(0)}{cell(1)}{cell(2)}{cell(3)}</>);
  }

  return (
    <>
      <div style={{ width: '100%', maxWidth: MAX_W, borderRadius: RADIUS, overflow: 'hidden', ...containerStyle }}>
        {inner}
      </div>
      {openIdx !== null && (
        <ImageLightbox images={slice} initialIndex={openIdx} onClose={() => setOpenIdx(null)} />
      )}
    </>
  );
}
