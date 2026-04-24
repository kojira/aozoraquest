import { useState } from 'react';
import { youtubeEmbedUrl } from '@/lib/youtube';

/**
 * YouTube の iframe 埋め込み。lazy (クリックまで iframe を出さない) で
 * ネットワーク / ページパフォーマンスへの影響を最小化。
 */
export function YoutubeEmbed({
  id,
  title,
  thumb,
}: {
  id: string;
  title?: string;
  thumb?: string;
}) {
  const [started, setStarted] = useState(false);
  // YouTube 標準サムネイル (external.thumb が無いとき用)
  const fallbackThumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const poster = thumb || fallbackThumb;

  return (
    <div
      style={{
        position: 'relative',
        marginTop: '0.5em',
        width: '100%',
        paddingTop: '56.25%',
        overflow: 'hidden',
        borderRadius: 6,
        background: '#000',
      }}
    >
      {!started ? (
        <button
          type="button"
          aria-label={title ? `YouTube: ${title}` : 'YouTube 動画を再生'}
          onClick={(e) => {
            e.stopPropagation();
            setStarted(true);
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            padding: 0,
            background: '#000',
            cursor: 'pointer',
          }}
        >
          <img
            src={poster}
            alt={title ?? ''}
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <span
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 68,
              height: 48,
              borderRadius: 8,
              background: 'rgba(230, 33, 23, 0.92)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              pointerEvents: 'none',
            }}
          >
            ▶
          </span>
          {title && (
            <span
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '8px 10px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0))',
                color: '#fff',
                fontSize: 13,
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </span>
          )}
        </button>
      ) : (
        <iframe
          src={`${youtubeEmbedUrl(id)}?autoplay=1`}
          title={title ?? 'YouTube video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}
