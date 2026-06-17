import { useState } from 'react';
import type { PostExternal } from '@/lib/post-embed';
import { useTranslation } from '@/lib/translate';
import { TranslationControls } from './post-body';
import { safeLinkUri } from './post-text';

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
  // OG カードの uri は投稿者が自由に付けられる (embed)。post-text の facet link と
  // 同じく javascript:/data: 等の保存型 XSS が成立するため http/https のみ許可。
  // 許可外は href を付けず (= クリックしても遷移しない非リンクカード) にする。
  const safeUri = safeLinkUri(external.uri);
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
  const [showOriginal, setShowOriginal] = useState(false);
  const titleDisplay = !showOriginal && titleTr.translated ? titleTr.translated : external.title;
  const descDisplay = !showOriginal && descTr.translated ? descTr.translated : external.description;
  const hasTranslation = !!titleTr.translated || !!descTr.translated;
  // 2 つの翻訳 state を 1 つに統合 (UI 表示の優先順位)
  const combinedState: ReturnType<typeof useTranslation>['state'] =
    titleTr.state === 'loading' || descTr.state === 'loading' ? 'loading'
    : hasTranslation ? 'done'
    : titleTr.state === 'error' || descTr.state === 'error' ? 'error'
    : 'idle';
  const combinedError = titleTr.error ?? descTr.error;
  // どちらかでも翻訳対象なら controls を出す
  const showControls = titleTr.isNonJapanese || descTr.isNonJapanese;
  const onTriggerTranslate = () => {
    titleTr.triggerTranslate();
    descTr.triggerTranslate();
  };
  const onRetranslate = () => {
    setShowOriginal(false);
    titleTr.retranslate();
    descTr.retranslate();
  };
  return (
    <div
      style={{
        marginTop: '0.5em',
        padding: 8,
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        background: 'var(--color-overlay-soft)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <a
        {...(safeUri ? { href: safeUri } : {})}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          textDecoration: 'none',
          color: 'inherit',
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
      {showControls && (
        <TranslationControls
          state={combinedState}
          hasTranslation={hasTranslation}
          showOriginal={showOriginal}
          error={combinedError}
          onToggleOriginal={() => setShowOriginal((v) => !v)}
          onTranslate={onTriggerTranslate}
          onRetranslate={onRetranslate}
        />
      )}
    </div>
  );
}

function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return '';
  }
}
