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

/**
 * 投稿本文の描画。
 * - AT Protocol の facets があればそれに従ってリンク / メンション / タグを描画
 * - facets が無ければ URL を自動検出してリンク化
 * - 長い URL も word-break でカードからはみ出さない
 * - 外部リンクは別タブ、rel=noopener noreferrer
 */
export function PostText({ text, facets, style, override }: PostTextProps) {
  const effective = override ?? text;
  const parts =
    override === undefined && facets && facets.length > 0
      ? renderWithFacets(text, facets)
      : renderAutoLink(effective);

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
      {parts}
    </div>
  );
}

function renderWithFacets(text: string, facets: Facet[]): ReactNode[] {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);
  const sorted = [...facets]
    .filter((f) => f.index && typeof f.index.byteStart === 'number' && typeof f.index.byteEnd === 'number')
    .sort((a, b) => a.index.byteStart - b.index.byteStart);

  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const f of sorted) {
    const { byteStart, byteEnd } = f.index;
    if (byteStart < cursor || byteEnd > bytes.length || byteStart >= byteEnd) continue;
    if (byteStart > cursor) {
      out.push(<span key={key++}>{decoder.decode(bytes.slice(cursor, byteStart))}</span>);
    }
    const segment = decoder.decode(bytes.slice(byteStart, byteEnd));
    const feature = (f.features ?? [])[0];
    out.push(renderFeature(segment, feature, key++));
    cursor = byteEnd;
  }
  if (cursor < bytes.length) {
    out.push(<span key={key++}>{decoder.decode(bytes.slice(cursor))}</span>);
  }
  return out;
}

function renderFeature(segment: string, feature: FacetFeature | undefined, key: number): ReactNode {
  if (!feature) return <span key={key}>{segment}</span>;
  const t = feature.$type;
  if (t === 'app.bsky.richtext.facet#link' && feature.uri) {
    return <ExternalLink key={key} href={feature.uri} label={segment} />;
  }
  if (t === 'app.bsky.richtext.facet#mention' && feature.did) {
    const handle = segment.replace(/^@/, '');
    return (
      <Link key={key} to={`/profile/${handle}`}>
        {segment}
      </Link>
    );
  }
  if (t === 'app.bsky.richtext.facet#tag' && feature.tag) {
    return (
      <Link key={key} to={`/search?q=${encodeURIComponent('#' + feature.tag)}`}>
        {segment}
      </Link>
    );
  }
  return <span key={key}>{segment}</span>;
}

function renderAutoLink(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  let last = 0;
  for (const m of text.matchAll(AUTO_LINK_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<span key={key++}>{text.slice(last, start)}</span>);
    const matched = m[0];
    if (m[1]) {
      // http(s)://
      out.push(<ExternalLink key={key++} href={matched} label={matched} />);
    } else if (m[2]) {
      // www.xxx (no scheme) → https を補う
      out.push(<ExternalLink key={key++} href={`https://${matched}`} label={matched} />);
    } else if (m[3]) {
      // #hashtag
      const tag = matched.replace(/^[#＃]/, '');
      out.push(
        <Link key={key++} to={`/search?q=${encodeURIComponent('#' + tag)}`} onClick={(e) => e.stopPropagation()}>
          {matched}
        </Link>,
      );
    } else if (m[4]) {
      // @mention
      const handle = matched.slice(1);
      out.push(
        <Link key={key++} to={`/profile/${handle}`} onClick={(e) => e.stopPropagation()}>
          {matched}
        </Link>,
      );
    }
    last = start + matched.length;
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>);
  return out;
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
