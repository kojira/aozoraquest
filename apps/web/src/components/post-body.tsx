import type { CSSProperties } from 'react';
import type { PostExternal, PostImage } from '@/lib/post-embed';
import { PostText, type Facet } from './post-text';
import { PostImages } from './post-images';
import { PostExternalCard } from './post-external';

/**
 * 投稿本文 (テキスト + 画像 + 外部リンクカード) の共通レイアウト。
 *
 * 画像が 0 枚: テキストのみ。1 枚以上: 左に正方形グリッド、右にテキスト
 * (縦方向は画像が中央、テキストは alignSelf: flex-start で上部配置)。
 * 外部リンクカードがある場合はテキスト / 画像行の下にフル幅で追加。
 *
 * home / search / profile の 3 箇所で同じロジックだったのを 1 コンポーネントに寄せた。
 */
export interface PostBodyProps {
  text: string;
  facets?: Facet[] | undefined;
  images?: PostImage[] | undefined;
  external?: PostExternal | null | undefined;
  /** 本文ブロックの上マージン。既定 0.45em。 */
  topMargin?: CSSProperties['marginTop'];
}

export function PostBody({ text, facets, images, external, topMargin = '0.45em' }: PostBodyProps) {
  const hasImages = images && images.length > 0;
  const textBlock = hasImages ? (
    <div style={{ display: 'flex', gap: '0.6em', alignItems: 'center', marginTop: topMargin }}>
      <PostImages images={images} />
      <div style={{ flex: 1, minWidth: 0, alignSelf: 'flex-start' }}>
        <PostText text={text} facets={facets} />
      </div>
    </div>
  ) : (
    <PostText text={text} facets={facets} style={{ marginTop: topMargin }} />
  );
  return (
    <>
      {textBlock}
      {external && <PostExternalCard external={external} />}
    </>
  );
}
