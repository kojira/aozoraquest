import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PostQuote } from '@/lib/post-embed';
import { didFromUri, postDetailPath } from '@/lib/uri';
import { useColumnNav } from './column-detail';
import { Avatar } from './avatar';
import { PostText } from './post-text';

/**
 * 引用投稿カード (Bluesky 本家の「ぶら下げ」表示相当)。
 *
 * カード全体をタップ / Enter・Space で引用先投稿へ**内部遷移**する。外側を
 * `<a>`/`<Link>` で包むと本文中の mention/リンク (これも `<a>`) が入れ子アンカーになり
 * 不正 HTML になるため、`<div role="link" tabIndex>` + useNavigate で遷移する
 * (本文中リンクは自前の stopPropagation で個別に効く。closest('a,button') ガードは保険)。
 */
export function PostQuoteCard({ quote }: { quote: PostQuote }) {
  const navigate = useNavigate();
  const columnNav = useColumnNav();

  const box: CSSProperties = {
    marginTop: '0.5em',
    padding: 8,
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    background: 'var(--color-overlay-soft)',
  };

  if (quote.kind === 'unavailable') {
    const label =
      quote.reason === 'notFound'
        ? '引用先の投稿が見つかりません'
        : quote.reason === 'blocked'
          ? 'ブロックされた投稿です'
          : '引用元により引用が解除されました';
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
  // カラム内なら詳細を積む (TL 保持)。カラム外 (全画面ルート等) は route 遷移。
  const go = () => {
    if (columnNav) columnNav.openPost(quote.uri, quote.author.handle);
    else navigate(to);
  };
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 親投稿カードのクリックには伝播させない (引用先へ飛ぶのが意図)。
    e.stopPropagation();
    // 本文中リンク/ボタンを踏んだときはカード遷移しない (二重遷移を避ける)。
    if ((e.target as HTMLElement).closest('a,button')) return;
    go();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // カード自身にフォーカスがある時のみ (内部リンクにフォーカス中は素通し)。
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  };

  const authorName = quote.author.displayName || quote.author.handle || '名称不明';

  return (
    <div
      className="dq-quote-card"
      style={{ ...box, cursor: 'pointer' }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="link"
      tabIndex={0}
      aria-label={`引用先の投稿を開く: ${authorName}`}
    >
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
        <strong style={{ color: 'var(--color-fg)' }}>{authorName}</strong>
        {quote.author.handle && <span>@{quote.author.handle}</span>}
      </div>
      {quote.text && (
        <PostText
          text={quote.text}
          facets={quote.facets}
          style={{
            marginTop: '0.3em',
            fontSize: '0.95em',
            lineHeight: 1.5,
            // 長い引用でタイムラインが膨れないよう本文を最大 6 行にクランプ (本家同様)。
            display: '-webkit-box',
            WebkitLineClamp: 6,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        />
      )}
      {quote.images.length > 0 && (
        <div style={{ marginTop: '0.4em', display: 'flex', gap: 4 }}>
          {quote.images.slice(0, 4).map((img, i) => (
            <img
              key={i}
              src={img.thumb}
              alt={img.alt}
              loading="lazy"
              decoding="async"
              // 枚数に応じて等分 (狭幅でもはみ出さない)。単独時に巨大化しないよう上限。
              style={{
                flex: '1 1 0',
                minWidth: 0,
                maxWidth: 88,
                aspectRatio: '1 / 1',
                objectFit: 'cover',
                borderRadius: 4,
                background: '#000',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
