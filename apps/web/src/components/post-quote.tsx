import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PostQuote } from '@/lib/post-embed';
import { didFromUri, postDetailPath } from '@/lib/uri';
import { Avatar } from './avatar';
import { PostText } from './post-text';

/**
 * 引用投稿カード (Bluesky 本家の「ぶら下げ」表示相当)。
 *
 * カード全体をタップすると引用先投稿へ**内部遷移**する。ただし外側を `<a>`/`<Link>`
 * で包むと、本文中の mention/リンク (これも `<a>`) が入れ子アンカーになり不正 HTML に
 * なるため、`<div onClick>` + useNavigate で遷移する (本文中リンクは自前の
 * stopPropagation で個別に効く)。closest('a,button') ガードは保険。
 */
export function PostQuoteCard({ quote }: { quote: PostQuote }) {
  const navigate = useNavigate();

  const box: CSSProperties = {
    marginTop: '0.5em',
    padding: 8,
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    background: 'var(--color-overlay-soft)',
  };

  if (quote.kind === 'unavailable') {
    const label =
      quote.reason === 'notFound'
        ? '引用先の投稿が見つかりません'
        : quote.reason === 'blocked'
          ? 'ブロックされた投稿'
          : '引用が取り消されました';
    return (
      <div style={{ ...box, color: 'var(--color-muted)', fontSize: '0.85em' }} onClick={(e) => e.stopPropagation()}>
        {label}
      </div>
    );
  }

  if (quote.kind === 'other') {
    return (
      <div style={{ ...box, color: 'var(--color-muted)', fontSize: '0.85em' }} onClick={(e) => e.stopPropagation()}>
        {quote.label}
      </div>
    );
  }

  // handle があれば /profile/<handle>/post/<rkey>、無ければ at-uri の DID で代替
  // (profile ルートは DID をそのまま解決できる)。/post/<uri> 素通しは未登録ルートなので避ける。
  const to = postDetailPath(quote.author.handle || didFromUri(quote.uri), quote.uri);
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 親投稿カードのクリックには伝播させない (引用先へ飛ぶのが意図)。
    e.stopPropagation();
    // 本文中リンク/ボタンを踏んだときはカード遷移しない (二重遷移を避ける)。
    if ((e.target as HTMLElement).closest('a,button')) return;
    navigate(to);
  };

  return (
    <div style={{ ...box, cursor: 'pointer' }} onClick={onClick}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4em',
          fontSize: '0.85em',
          color: 'var(--color-muted)',
        }}
      >
        <Avatar src={quote.author.avatar} size={20} archetype={null} />
        <strong style={{ color: 'var(--color-fg)' }}>
          {quote.author.displayName || quote.author.handle || '(不明)'}
        </strong>
        {quote.author.handle && <span>@{quote.author.handle}</span>}
      </div>
      {quote.text && (
        <PostText
          text={quote.text}
          facets={quote.facets}
          style={{ marginTop: '0.3em', fontSize: '0.95em', lineHeight: 1.5 }}
        />
      )}
      {quote.images.length > 0 && (
        <div style={{ marginTop: '0.4em', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {quote.images.slice(0, 4).map((img, i) => (
            <img
              key={i}
              src={img.thumb}
              alt={img.alt}
              loading="lazy"
              decoding="async"
              style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, flexShrink: 0, background: '#000' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
