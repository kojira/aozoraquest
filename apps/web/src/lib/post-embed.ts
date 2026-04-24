import type { AppBskyFeedDefs } from '@atproto/api';

/** 投稿カード / ライトボックスで使う 1 枚分の画像。 */
export interface PostImage {
  thumb: string;
  fullsize: string;
  alt: string;
  aspectRatio?: { width: number; height: number };
}

/** 外部リンクカード (app.bsky.embed.external#view)。 */
export interface PostExternal {
  uri: string;
  title: string;
  description: string;
  thumb?: string;
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

interface ExternalViewShape {
  $type?: string;
  external?: {
    uri?: unknown;
    title?: unknown;
    description?: unknown;
    thumb?: unknown;
  };
}

interface EmbedShape {
  $type?: string;
  images?: ViewImageShape[];
  external?: ExternalViewShape['external'];
  media?: { $type?: string; images?: ViewImageShape[]; external?: ExternalViewShape['external'] };
}

/**
 * post.embed から画像配列を安全に抽出する。
 * - app.bsky.embed.images#view: 単純な画像添付
 * - app.bsky.embed.recordWithMedia#view: 引用投稿 + メディア (media 側が images)
 * どちらも拾う。どれにも該当しないときは空配列を返す。
 */
export function extractPostImages(post: AppBskyFeedDefs.PostView): PostImage[] {
  const embed = post.embed as EmbedShape | undefined;
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

/**
 * post.embed から外部リンクカードを抽出する。
 * - app.bsky.embed.external#view
 * - app.bsky.embed.recordWithMedia#view の media 側
 */
export function extractPostExternal(post: AppBskyFeedDefs.PostView): PostExternal | null {
  const embed = post.embed as EmbedShape | undefined;
  if (!embed) return null;

  const pick = (e: ExternalViewShape['external'] | undefined): PostExternal | null => {
    if (!e) return null;
    if (typeof e.uri !== 'string') return null;
    return {
      uri: e.uri,
      title: typeof e.title === 'string' ? e.title : '',
      description: typeof e.description === 'string' ? e.description : '',
      ...(typeof e.thumb === 'string' ? { thumb: e.thumb } : {}),
    };
  };

  if (embed.$type === 'app.bsky.embed.external#view') {
    return pick(embed.external);
  }
  if (embed.media && embed.media.$type === 'app.bsky.embed.external#view') {
    return pick(embed.media.external);
  }
  return null;
}
