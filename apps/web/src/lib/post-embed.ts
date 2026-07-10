import type { AppBskyFeedDefs } from '@atproto/api';
import type { Facet } from '@/lib/facet';

/** 投稿カード / ライトボックスで使う 1 枚分の画像。 */
export interface PostImage {
  thumb: string;
  fullsize: string;
  alt: string;
  aspectRatio?: { width: number; height: number };
}

/**
 * 引用投稿 (app.bsky.embed.record#view / recordWithMedia#view の record 部)。
 * Bluesky 本家がリンク先投稿を「ぶら下げ」表示するのと同じ埋め込みデータ。
 * - kind='post': 通常の投稿を引用 (viewRecord)。カード表示 + タップで内部遷移。
 * - kind='unavailable': 未検出 / ブロック / 引用解除 (viewNotFound/Blocked/Detached)。
 * - kind='other': フィード / リスト / スターターパック等、投稿以外の埋め込み。
 */
export type PostQuote =
  | {
      kind: 'post';
      uri: string;
      author: { handle: string; displayName: string; avatar?: string };
      text: string;
      facets?: Facet[];
      images: PostImage[];
      createdAt?: string;
    }
  | { kind: 'unavailable'; reason: 'notFound' | 'blocked' | 'detached' }
  | { kind: 'other'; label: string };

/** 外部リンクカード (app.bsky.embed.external#view)。 */
export interface PostExternal {
  uri: string;
  title: string;
  description: string;
  thumb?: string;
}

/** Bluesky ネイティブ動画 (app.bsky.embed.video#view)。HLS (.m3u8) 再生。 */
export interface PostVideo {
  playlist: string;
  thumbnail?: string;
  alt?: string;
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

interface ExternalViewShape {
  $type?: string;
  external?: {
    uri?: unknown;
    title?: unknown;
    description?: unknown;
    thumb?: unknown;
  };
}

interface VideoViewShape {
  $type?: string;
  playlist?: unknown;
  thumbnail?: unknown;
  alt?: unknown;
  aspectRatio?: { width?: unknown; height?: unknown };
}

interface EmbedShape {
  $type?: string;
  playlist?: unknown;
  thumbnail?: unknown;
  alt?: unknown;
  aspectRatio?: { width?: unknown; height?: unknown };
  images?: ViewImageShape[];
  external?: ExternalViewShape['external'];
  media?: {
    $type?: string;
    images?: ViewImageShape[];
    external?: ExternalViewShape['external'];
    playlist?: VideoViewShape['playlist'];
    thumbnail?: VideoViewShape['thumbnail'];
    alt?: VideoViewShape['alt'];
    aspectRatio?: VideoViewShape['aspectRatio'];
  };
}

function imagesFromEmbed(embed: EmbedShape | undefined): PostImage[] {
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
 * post.embed から画像配列を安全に抽出する。
 * - app.bsky.embed.images#view: 単純な画像添付
 * - app.bsky.embed.recordWithMedia#view: 引用投稿 + メディア (media 側が images)
 * どちらも拾う。どれにも該当しないときは空配列を返す。
 */
export function extractPostImages(post: AppBskyFeedDefs.PostView): PostImage[] {
  return imagesFromEmbed(post.embed as EmbedShape | undefined);
}

/** 引用埋め込みの record union (viewRecord 等) の shape。実体は AT Protocol の union。 */
interface ViewRecordShape {
  $type?: string;
  uri?: unknown;
  author?: { handle?: unknown; displayName?: unknown; avatar?: unknown };
  value?: { text?: unknown; facets?: unknown; createdAt?: unknown };
  embeds?: EmbedShape[];
}

function toQuotePost(r: ViewRecordShape): PostQuote | null {
  if (typeof r.uri !== 'string') return null;
  const a = r.author ?? {};
  const v = r.value ?? {};
  // 引用先が自前で持つ添付画像 (embeds は複数種類の埋め込みビュー配列)。最初に
  // 画像を含む埋め込みだけサムネ表示に使う (引用カードは軽量表示に留める)。
  let images: PostImage[] = [];
  for (const e of r.embeds ?? []) {
    const imgs = imagesFromEmbed(e);
    if (imgs.length) {
      images = imgs;
      break;
    }
  }
  return {
    kind: 'post',
    uri: r.uri,
    author: {
      handle: typeof a.handle === 'string' ? a.handle : '',
      displayName: typeof a.displayName === 'string' ? a.displayName : '',
      ...(typeof a.avatar === 'string' ? { avatar: a.avatar } : {}),
    },
    text: typeof v.text === 'string' ? v.text : '',
    ...(Array.isArray(v.facets) ? { facets: v.facets as Facet[] } : {}),
    images,
    ...(typeof v.createdAt === 'string' ? { createdAt: v.createdAt } : {}),
  };
}

/**
 * post.embed から引用投稿を抽出する。
 * - app.bsky.embed.record#view: 純粋な引用 (record 単体)
 * - app.bsky.embed.recordWithMedia#view: 引用 + メディア (record.record が union)
 * record union の $type を見て post / 未取得系 / それ以外 (フィード等) に振り分ける。
 * どれにも該当しなければ null (= 引用なし)。
 */
export function extractPostQuote(post: AppBskyFeedDefs.PostView): PostQuote | null {
  const embed = post.embed as
    | (EmbedShape & { record?: unknown })
    | undefined;
  if (!embed) return null;

  let recordUnion: unknown = null;
  if (embed.$type === 'app.bsky.embed.record#view') {
    recordUnion = (embed as { record?: unknown }).record;
  } else if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    // recordWithMedia は record ラッパを一段挟む: { record: { record: <union> }, media }
    const wrapper = (embed as { record?: { record?: unknown } }).record;
    recordUnion = wrapper?.record;
  }
  if (!recordUnion || typeof recordUnion !== 'object') return null;

  const str = (x: unknown): string => (typeof x === 'string' ? x : '');
  const r = recordUnion as { $type?: string; displayName?: unknown; name?: unknown };
  switch (r.$type) {
    case 'app.bsky.embed.record#viewRecord':
      return toQuotePost(r as ViewRecordShape);
    case 'app.bsky.embed.record#viewNotFound':
      return { kind: 'unavailable', reason: 'notFound' };
    case 'app.bsky.embed.record#viewBlocked':
      return { kind: 'unavailable', reason: 'blocked' };
    case 'app.bsky.embed.record#viewDetached':
      return { kind: 'unavailable', reason: 'detached' };
    case 'app.bsky.feed.defs#generatorView':
      return { kind: 'other', label: `フィード: ${str(r.displayName) || '(名称不明)'}` };
    case 'app.bsky.graph.defs#listView':
      return { kind: 'other', label: `リスト: ${str(r.name) || '(名称不明)'}` };
    case 'app.bsky.graph.defs#starterPackViewBasic':
      return { kind: 'other', label: 'スターターパック' };
    case 'app.bsky.labeler.defs#labelerView':
      return { kind: 'other', label: 'ラベラー' };
    default:
      return null;
  }
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

/** post.embed から動画情報を抽出。 */
export function extractPostVideo(post: AppBskyFeedDefs.PostView): PostVideo | null {
  const embed = post.embed as EmbedShape | undefined;
  if (!embed) return null;

  const pick = (v: {
    playlist?: unknown;
    thumbnail?: unknown;
    alt?: unknown;
    aspectRatio?: { width?: unknown; height?: unknown } | undefined;
  } | undefined): PostVideo | null => {
    if (!v) return null;
    if (typeof v.playlist !== 'string') return null;
    const out: PostVideo = { playlist: v.playlist };
    if (typeof v.thumbnail === 'string') out.thumbnail = v.thumbnail;
    if (typeof v.alt === 'string') out.alt = v.alt;
    const ar = v.aspectRatio;
    if (ar && typeof ar.width === 'number' && typeof ar.height === 'number') {
      out.aspectRatio = { width: ar.width, height: ar.height };
    }
    return out;
  };

  if (embed.$type === 'app.bsky.embed.video#view') {
    return pick(embed);
  }
  if (embed.media && embed.media.$type === 'app.bsky.embed.video#view') {
    return pick(embed.media);
  }
  return null;
}
