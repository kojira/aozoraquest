import type { PostExternal } from '@/lib/post-embed';
import { useTranslation } from '@/lib/translate';

/**
 * 外部リンクカード (app.bsky.embed.external#view)。
 * Bluesky 本家の Open Graph プレビューに相当。サムネイル (あれば) + タイトル +
 * ドメイン + 説明を横並びで表示し、カード全体を外部リンクにする。
 *
 * title / description は **投稿本文と同じ翻訳経路**で日本語化する (非日本語
 * 判定時、自動翻訳設定 ON ならカード mount 時に発火)。キャッシュキーは
 * `og-title:<url>` / `og-desc:<url>` で実 post URI と衝突しない。
 */
export function PostExternalCard({ external }: { external: PostExternal }) {
  const host = safeHost(external.uri);
  // useTranslation は uri=undefined or text=空 / 短い時は no-op (= isNonJapanese=false)
  // なので、title/desc が無い OG カードでも安全に呼べる。
  const titleHasText = !!external.title && external.title.length > 0;
  const descHasText = !!external.description && external.description.length > 0;
  const titleTr = useTranslation(
    titleHasText ? `og-title:${external.uri}` : undefined,
    external.title ?? '',
  );
  const descTr = useTranslation(
    descHasText ? `og-desc:${external.uri}` : undefined,
    external.description ?? '',
  );
  const titleDisplay = titleTr.translated ?? external.title;
  const descDisplay = descTr.translated ?? external.description;
  const anyTranslated = !!titleTr.translated || !!descTr.translated;
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
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{host}</span>
            {anyTranslated && (
              <span title="日本語に翻訳済み" aria-label="日本語に翻訳済み" style={{ flexShrink: 0 }}>
                🌐
              </span>
            )}
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
          {titleDisplay || external.uri}
        </div>
        {descDisplay && (
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
            {descDisplay}
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
