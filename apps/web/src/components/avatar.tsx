import type { CSSProperties } from 'react';

interface AvatarProps {
  src?: string | undefined;
  alt?: string;
  size?: number;
  style?: CSSProperties;
}

/**
 * 円形アバター。
 *
 * ジャギーを避けるための工夫:
 * 1. **ラッパー div で overflow:hidden + border-radius:50%** を受け持つ。
 *    img 自体に border-radius を掛けない → 円形クリップがコンポジットレイヤで綺麗に効く。
 * 2. **img の intrinsic を 2× 表示サイズで要求**する。retina (2 DPR) の実ピクセル数と一致するので、
 *    縮小補間によるモアレ/エッジのギザつきが出ない。
 * 3. **リングは別 div の box-shadow**。img に border を付けると円形との合成で縁がカクつく。
 */
export function Avatar({ src, alt = '', size = 32, style }: AvatarProps) {
  const wrapper: CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    borderRadius: '50%',
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    flexShrink: 0,
    display: 'block',
    ...style,
  };

  const img: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'block',
    objectFit: 'cover',
  };

  if (!src) {
    return <div aria-hidden style={wrapper} />;
  }

  // retina 用に実ピクセルの 2 倍サイズで要求 (intrinsic サイズの指定)。
  // Bluesky CDN の avatar_thumbnail は元々十分大きい (256px 程度) ので、
  // width/height 属性を 2× にしておけばブラウザに「2x で描画する」ことを伝えられる。
  const intrinsic = size * 2;

  return (
    <div style={wrapper}>
      <img
        src={src}
        alt={alt}
        width={intrinsic}
        height={intrinsic}
        loading="lazy"
        decoding="async"
        style={img}
      />
    </div>
  );
}
