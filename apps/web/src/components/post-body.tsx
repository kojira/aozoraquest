import { useState, type CSSProperties } from 'react';
import type { PostExternal, PostImage, PostVideo } from '@/lib/post-embed';
import { PostText, type Facet } from './post-text';
import { PostImages } from './post-images';
import { PostExternalCard } from './post-external';
import { PostVideoCard } from './post-video';
import { YoutubeEmbed } from './youtube-embed';
import { youtubeId } from '@/lib/youtube';
import { useTranslation } from '@/lib/translate';

/**
 * 投稿本文 (テキスト + 画像 + 外部リンクカード) の共通レイアウト。
 *
 * 画像が 0 枚: テキストのみ。1 枚以上: 左に正方形グリッド、右にテキスト
 * (縦方向は画像が中央、テキストは alignSelf: flex-start で上部配置)。
 * 外部リンクカードがある場合はテキスト / 画像行の下にフル幅で追加。
 *
 * `postUri` が渡されると、非日本語投稿に対して TinySwallow による翻訳を
 * オンデマンドで表示 (自動翻訳設定 ON ならロード時に自動開始)。
 */
export interface PostBodyProps {
  text: string;
  facets?: Facet[] | undefined;
  images?: PostImage[] | undefined;
  external?: PostExternal | null | undefined;
  video?: PostVideo | null | undefined;
  /** 翻訳キャッシュのキー兼有無判定に使う。profile の RecentPosts など
   *  URI が無い場面では翻訳機能を無効化する。 */
  postUri?: string | undefined;
  /** 投稿者が付けた言語タグ (例: ['en'], ['ja'])。判定精度が高いので優先。 */
  langs?: string[] | undefined;
  /** 本文ブロックの上マージン。既定 0.45em。 */
  topMargin?: CSSProperties['marginTop'];
}

export function PostBody({ text, facets, images, external, video, postUri, langs, topMargin = '0.45em' }: PostBodyProps) {
  const hasImages = images && images.length > 0;
  const { state, translated, error, triggerTranslate, retranslate, isNonJapanese } = useTranslation(postUri, text, langs);
  const [showOriginal, setShowOriginal] = useState(false);

  const displayText = !showOriginal && translated ? translated : undefined;

  const textNode = (
    <div>
      <PostText text={text} facets={facets} override={displayText} />
      {isNonJapanese && (
        <TranslationControls
          state={state}
          hasTranslation={!!translated}
          showOriginal={showOriginal}
          error={error}
          onToggleOriginal={() => setShowOriginal((v) => !v)}
          onTranslate={triggerTranslate}
          onRetranslate={() => {
            setShowOriginal(false); // 再翻訳ボタンを押したら訳文表示に戻す
            retranslate();
          }}
        />
      )}
    </div>
  );

  const textBlock = hasImages ? (
    <div style={{ display: 'flex', gap: '0.6em', alignItems: 'center', marginTop: topMargin }}>
      <PostImages images={images} />
      <div style={{ flex: 1, minWidth: 0, alignSelf: 'flex-start' }}>{textNode}</div>
    </div>
  ) : (
    <div style={{ marginTop: topMargin }}>{textNode}</div>
  );

  // 外部リンクが YouTube なら iframe 埋め込み、それ以外なら OG カード
  const ytId = external ? youtubeId(external.uri) : null;

  return (
    <>
      {textBlock}
      {video && <PostVideoCard video={video} />}
      {external && ytId && (
        <YoutubeEmbed id={ytId} {...(external.title ? { title: external.title } : {})} {...(external.thumb ? { thumb: external.thumb } : {})} />
      )}
      {external && !ytId && <PostExternalCard external={external} />}
    </>
  );
}

function TranslationControls({
  state,
  hasTranslation,
  showOriginal,
  error,
  onToggleOriginal,
  onTranslate,
  onRetranslate,
}: {
  state: ReturnType<typeof useTranslation>['state'];
  hasTranslation: boolean;
  showOriginal: boolean;
  error: string | undefined;
  onToggleOriginal: () => void;
  onTranslate: () => void;
  onRetranslate: () => void;
}) {
  const baseStyle: CSSProperties = {
    fontSize: '0.75em',
    color: 'var(--color-muted)',
    marginTop: '0.3em',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5em',
  };
  if (state === 'idle') {
    return (
      <div style={baseStyle}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTranslate();
          }}
          style={linkButtonStyle}
        >
          🌐 翻訳する
        </button>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div style={baseStyle}>
        <span>🌐 翻訳中…</span>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div style={{ ...baseStyle, color: 'var(--color-danger)' }}>
        <span>🌐 翻訳失敗</span>
        {error && <span style={{ opacity: 0.7 }}>({truncate(error, 60)})</span>}
        <button type="button" onClick={(e) => { e.stopPropagation(); onTranslate(); }} style={linkButtonStyle}>
          再試行
        </button>
      </div>
    );
  }
  // done
  if (!hasTranslation) return null;
  return (
    <div style={baseStyle}>
      <span>🌐 {showOriginal ? '原文を表示中' : '訳文を表示中'}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleOriginal();
        }}
        style={linkButtonStyle}
      >
        {showOriginal ? '訳文を見る' : '原文を見る'}
      </button>
      <span style={{ opacity: 0.4 }}>|</span>
      <button
        type="button"
        title="キャッシュを無視して翻訳し直す"
        onClick={(e) => {
          e.stopPropagation();
          onRetranslate();
        }}
        style={linkButtonStyle}
      >
        再翻訳
      </button>
    </div>
  );
}

const linkButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: 'var(--color-accent)',
  cursor: 'pointer',
  fontSize: 'inherit',
  textDecoration: 'underline',
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
