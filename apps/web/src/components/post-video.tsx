import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { PostVideo } from '@/lib/post-embed';

/**
 * Bluesky ネイティブ動画 (HLS / .m3u8) の再生。
 * Safari は HLS をネイティブ対応するのでそのまま <video> に src を渡す。
 * 他のブラウザは hls.js を動的にアタッチ。
 *
 * 初期状態はサムネイル + 再生ボタン (タップで再生開始)。オートプレイしない。
 */
export function PostVideoCard({ video }: { video: PostVideo }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
    const el = videoRef.current;
    if (!el) return;

    // Safari は native HLS 対応
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = video.playlist;
      el.play().catch(() => {});
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(video.playlist);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        el.play().catch(() => {});
      });
      return () => {
        hls.destroy();
      };
    }

    // どちらも無理なら native に託す (ほぼ使われない)
    el.src = video.playlist;
    return undefined;
  }, [started, video.playlist]);

  const ar = video.aspectRatio;
  const paddingTop = ar ? `${(ar.height / ar.width) * 100}%` : '56.25%';

  return (
    <div
      style={{
        position: 'relative',
        marginTop: '0.5em',
        width: '100%',
        paddingTop,
        overflow: 'hidden',
        borderRadius: 6,
        background: '#000',
      }}
    >
      {!started ? (
        <button
          type="button"
          aria-label="動画を再生"
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
          {video.thumbnail && (
            <img
              src={video.thumbnail}
              alt={video.alt ?? ''}
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
          <span
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 56,
              height: 56,
              borderRadius: 28,
              background: 'rgba(0,0,0,0.65)',
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
        </button>
      ) : (
        <video
          ref={videoRef}
          controls
          playsInline
          {...(video.thumbnail ? { poster: video.thumbnail } : {})}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}
