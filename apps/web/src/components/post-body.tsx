import type { CSSProperties } from 'react';
import type { PostImage } from '@/lib/post-embed';
import { PostText, type Facet } from './post-text';
import { PostImages } from './post-images';

/**
 * 投稿本文 (テキスト + 画像) の共通レイアウト。
 *
 * 画像が 0 枚: テキストのみ (従来通り)。
 * 画像が 1 枚以上: 左に正方形グリッド、右にテキスト。縦方向は画像が中央、
 * テキストは上部配置 (flex alignItems: center + テキスト側 alignSelf: flex-start)。
 *
 * home / search / profile の 3 箇所で同じロジックだったのを 1 コンポーネントに寄せた。
 */
export interface PostBodyProps {
  text: string;
  facets?: Facet[] | undefined;
  images?: PostImage[] | undefined;
  /** 本文ブロックの上マージン。既定 0.45em。 */
  topMargin?: CSSProperties['marginTop'];
}

export function PostBody({ text, facets, images, topMargin = '0.45em' }: PostBodyProps) {
  const hasImages = images && images.length > 0;
  if (!hasImages) {
    return <PostText text={text} facets={facets} style={{ marginTop: topMargin }} />;
  }
  return (
    <div style={{ display: 'flex', gap: '0.6em', alignItems: 'center', marginTop: topMargin }}>
      <PostImages images={images} />
      <div style={{ flex: 1, minWidth: 0, alignSelf: 'flex-start' }}>
        <PostText text={text} facets={facets} />
      </div>
    </div>
  );
}
