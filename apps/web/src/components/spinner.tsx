/**
 * 控えめな円形スピナー (CSS のみ)。
 *
 * data fetch / 処理中であることを即座に伝える。インタラクションのフィードバック
 * 不在感を和らげるのが主目的。
 */
import type { CSSProperties } from 'react';

interface SpinnerProps {
  size?: number;
  /** 線の太さ。size に応じて自動 */
  thickness?: number;
  color?: string;
  /** 並列フィードバック (例: 「カード情報を読み込み中…」) を右に添える */
  label?: string;
  style?: CSSProperties;
}

export function Spinner({ size = 18, thickness, color = 'var(--color-accent)', label, style }: SpinnerProps) {
  const t = thickness ?? Math.max(2, Math.round(size / 9));
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label ?? '読み込み中'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5em',
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: size,
          height: size,
          display: 'inline-block',
          borderRadius: '50%',
          border: `${t}px solid rgba(255, 255, 255, 0.18)`,
          borderTopColor: color,
          animation: 'aq-spinner-rotate 720ms linear infinite',
          flexShrink: 0,
        }}
      />
      {label && (
        <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{label}</span>
      )}
    </span>
  );
}
