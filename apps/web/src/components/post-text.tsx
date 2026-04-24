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
}

const URL_RE = /https?:\/\/[^\s\u3000]+/g;

/**
 * 投稿本文の描画。
 * - AT Protocol の facets があればそれに従ってリンク / メンション / タグを描画
 * - facets が無ければ URL を自動検出してリンク化
 * - 長い URL も word-break でカードからはみ出さない
 * - 外部リンクは別タブ、rel=noopener noreferrer
 */
export function PostText({ text, facets, style }: PostTextProps) {
  const parts = facets && facets.length > 0 ? renderWithFacets(text, facets) : renderAutoLink(text);

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
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<span key={key++}>{text.slice(last, start)}</span>);
    const url = m[0];
    out.push(<ExternalLink key={key++} href={url} label={url} />);
    last = start + url.length;
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
