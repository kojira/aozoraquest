import type { PostExternal } from '@/lib/post-embed';

/**
 * 外部リンクカード (app.bsky.embed.external#view)。
 * Bluesky 本家の Open Graph プレビューに相当。サムネイル (あれば) + タイトル +
 * ドメイン + 説明を横並びで表示し、カード全体を外部リンクにする。
 */
export function PostExternalCard({ external }: { external: PostExternal }) {
  const host = safeHost(external.uri);
  return (
    <a
      href={external.uri}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        marginTop: '0.5em',
        padding: 8,
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'inherit',
        background: 'rgba(255, 255, 255, 0.03)',
      }}
    >
      {external.thumb && (
        <img
          src={external.thumb}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            width: 72,
            height: 72,
            borderRadius: 4,
            objectFit: 'cover',
            flexShrink: 0,
            background: '#000',
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {host && (
          <div
            style={{
              fontSize: '0.75em',
              color: 'var(--color-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {host}
          </div>
        )}
        <div
          style={{
            fontWeight: 700,
            fontSize: '0.95em',
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {external.title || external.uri}
        </div>
        {external.description && (
          <div
            style={{
              fontSize: '0.85em',
              color: 'var(--color-muted)',
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {external.description}
          </div>
        )}
      </div>
    </a>
  );
}

function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return '';
  }
}
