import type { AppBskyFeedDefs } from '@atproto/api';

/** 投稿カード / ライトボックスで使う 1 枚分の画像。 */
export interface PostImage {
  thumb: string;
  fullsize: string;
  alt: string;
  aspectRatio?: { width: number; height: number };
}

interface ViewImageShape {
  thumb?: unknown;
  fullsize?: unknown;
  alt?: unknown;
  aspectRatio?: { width?: unknown; height?: unknown };
}

function toPostImage(v: ViewImageShape): PostImage | null {
  if (typeof v.thumb !== 'string' || typeof v.fullsize !== 'string') return null;
  const out: PostImage = {
    thumb: v.thumb,
    fullsize: v.fullsize,
    alt: typeof v.alt === 'string' ? v.alt : '',
  };
  const ar = v.aspectRatio;
  if (ar && typeof ar.width === 'number' && typeof ar.height === 'number') {
    out.aspectRatio = { width: ar.width, height: ar.height };
  }
  return out;
}

/**
 * post.embed から画像配列を安全に抽出する。
 * - app.bsky.embed.images#view: 単純な画像添付
 * - app.bsky.embed.recordWithMedia#view: 引用投稿 + メディア (media 側が images)
 * どちらも拾う。どれにも該当しないときは空配列を返す。
 */
export function extractPostImages(post: AppBskyFeedDefs.PostView): PostImage[] {
  const embed = post.embed as
    | { $type?: string; images?: ViewImageShape[]; media?: { $type?: string; images?: ViewImageShape[] } }
    | undefined;
  if (!embed) return [];

  const fromList = (list: ViewImageShape[] | undefined): PostImage[] => {
    if (!Array.isArray(list)) return [];
    const out: PostImage[] = [];
    for (const v of list) {
      const img = toPostImage(v);
      if (img) out.push(img);
    }
    return out;
  };

  if (embed.$type === 'app.bsky.embed.images#view') {
    return fromList(embed.images);
  }
  if (embed.media && embed.media.$type === 'app.bsky.embed.images#view') {
    return fromList(embed.media.images);
  }
  return [];
}
