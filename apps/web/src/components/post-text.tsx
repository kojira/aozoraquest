import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface FacetFeature {
  $type?: string;
  uri?: string;
  did?: string;
  tag?: string;
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features?: FacetFeature[];
}

interface PostTextProps {
  text: string;
  facets?: Facet[] | undefined;
  style?: CSSProperties;
  /** 指定されたら text の代わりに描画 (翻訳文の表示用)。facets は原文基準で
   *  bytes オフセットが合わないので無視。URL だけ自動リンクする。 */
  override?: string | undefined;
}

// facet が無いテキスト (自動検出用) でリンク / タグ / メンションを拾う。
// 1 パス処理: 最初にマッチしたものを採用 (重複判定は lastIndex で自然に回避)。
// - URL (https?://xxx) と bare www.xxx を両方拾う
// - #ハッシュタグ (日本語可)
// - @mention (handle スタイル)
const AUTO_LINK_RE =
  /(https?:\/\/[^\s\u3000]+)|((?:www\.)[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)*\.[a-zA-Z]{2,8}(?:\/[^\s\u3000]*)?)|([#＃][\w\u3040-\u30ff\u4e00-\u9fff_ー\-]+)|(@[A-Za-z0-9_.\-]+)/g;

/** 描画に依存しない投稿セグメント (テスト可能な純粋表現)。 */
export type PostSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; uri: string }
  | { kind: 'mention'; text: string; handle: string }
  | { kind: 'tag'; text: string; tag: string };

/** facet を持たないテキスト片を URL / #tag / @mention で分割する (自動リンク)。 */
function autoLinkSegments(text: string): PostSegment[] {
  const out: PostSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(AUTO_LINK_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    const matched = m[0];
    if (m[1]) {
      out.push({ kind: 'link', text: matched, uri: matched }); // http(s)://
    } else if (m[2]) {
      out.push({ kind: 'link', text: matched, uri: `https://${matched}` }); // www. → https 補完
    } else if (m[3]) {
      out.push({ kind: 'tag', text: matched, tag: matched.replace(/^[#＃]/, '') });
    } else if (m[4]) {
      out.push({ kind: 'mention', text: matched, handle: matched.slice(1) });
    }
    last = start + matched.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** facet 1 つ分のセグメント化。未知 feature は素のテキストとして返す。 */
function featureSegment(segment: string, feature: FacetFeature | undefined): PostSegment {
  const t = feature?.$type;
  if (t === 'app.bsky.richtext.facet#link' && feature?.uri) {
    return { kind: 'link', text: segment, uri: feature.uri };
  }
  if (t === 'app.bsky.richtext.facet#mention' && feature?.did) {
    return { kind: 'mention', text: segment, handle: segment.replace(/^@/, '') };
  }
  if (t === 'app.bsky.richtext.facet#tag' && feature?.tag) {
    return { kind: 'tag', text: segment, tag: feature.tag };
  }
  return { kind: 'text', text: segment };
}

/**
 * 投稿本文をセグメント列に変換する純粋関数 (描画非依存・テスト可能)。
 * - facets があればその範囲を feature 通りにリンク化し、**facet の隙間 (URL 等が
 *   facet 化されていない部分) は自動リンク**する。これがないと「#tag だけ facet が
 *   付いた投稿の URL が素のテキストになる」不具合が起きる (クエスト発行投稿など)。
 * - facets が無ければ全文を自動リンク。
 */
export function segmentPost(text: string, facets?: Facet[]): PostSegment[] {
  if (!facets || facets.length === 0) return autoLinkSegments(text);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);
  const sorted = [...facets]
    .filter((f) => f.index && typeof f.index.byteStart === 'number' && typeof f.index.byteEnd === 'number')
    .sort((a, b) => a.index.byteStart - b.index.byteStart);

  const out: PostSegment[] = [];
  let cursor = 0;
  for (const f of sorted) {
    const { byteStart, byteEnd } = f.index;
    // 範囲外 / 重複 / 逆順は無視 (壊れた facet で本文が欠落しないよう gap 処理は続行)
    if (byteStart < cursor || byteEnd > bytes.length || byteStart >= byteEnd) continue;
    if (byteStart > cursor) {
      // facet と facet の隙間は自動リンク (素の URL を拾う)
      out.push(...autoLinkSegments(decoder.decode(bytes.slice(cursor, byteStart))));
    }
    const segment = decoder.decode(bytes.slice(byteStart, byteEnd));
    out.push(featureSegment(segment, (f.features ?? [])[0]));
    cursor = byteEnd;
  }
  if (cursor < bytes.length) {
    out.push(...autoLinkSegments(decoder.decode(bytes.slice(cursor))));
  }
  return out;
}

/**
 * 投稿本文の描画。
 * - AT Protocol の facets があればそれに従ってリンク / メンション / タグを描画
 * - facet の隙間や facets が無い投稿は URL / #tag / @mention を自動リンク
 * - 長い URL も word-break でカードからはみ出さない
 * - 外部リンクは別タブ、rel=noopener noreferrer
 */
export function PostText({ text, facets, style, override }: PostTextProps) {
  const segments =
    override === undefined ? segmentPost(text, facets) : autoLinkSegments(override);

  return (
    <div
      style={{
        whiteSpace: 'pre-wrap',
        lineHeight: 1.7,
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        ...style,
      }}
    >
      {segments.map((seg, i) => renderSegment(seg, i))}
    </div>
  );
}

function renderSegment(seg: PostSegment, key: number): ReactNode {
  switch (seg.kind) {
    case 'link':
      return <ExternalLink key={key} href={seg.uri} label={seg.text} />;
    case 'mention':
      return (
        <Link key={key} to={`/profile/${seg.handle}`} onClick={(e) => e.stopPropagation()}>
          {seg.text}
        </Link>
      );
    case 'tag':
      return (
        <Link key={key} to={`/search?q=${encodeURIComponent('#' + seg.tag)}`} onClick={(e) => e.stopPropagation()}>
          {seg.text}
        </Link>
      );
    default:
      return <span key={key}>{seg.text}</span>;
  }
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{ wordBreak: 'break-all' }}
    >
      {label}
    </a>
  );
}
