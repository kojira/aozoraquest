import type { CSSProperties, ReactNode } from 'react';
import { SpiritIcon } from './spirit-icon';

interface SpiritBubbleProps {
  /** 本文 (複数行可) */
  children: ReactNode;
  /** アイコンのサイズ (px) */
  iconSize?: number;
  /** テキスト部分の font-size (例: '0.9em') */
  fontSize?: string;
  sleeping?: boolean;
  /** アイコンを表示するか。連続した吹き出しの 2 つ目以降で false にするとすっきりする。 */
  showIcon?: boolean;
  /** 外側コンテナに追加する style (達成済みのクエストを薄く見せる等)。 */
  style?: CSSProperties;
}

/**
 * 精霊の発言は必ずこの吹き出しで。アイコン (精霊キャラ) を左、右に本文。
 * アイコンからの吹き出し矢尻は小さな三角で表現。
 */
export function SpiritBubble({
  children,
  iconSize = 44,
  fontSize = '0.95em',
  sleeping = false,
  showIcon = true,
  style,
}: SpiritBubbleProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55em', ...style }}>
      {showIcon ? (
        <SpiritIcon size={iconSize} sleeping={sleeping} />
      ) : (
        <div style={{ width: iconSize, flexShrink: 0 }} aria-hidden />
      )}
      <div
        style={{
          position: 'relative',
          flex: 1,
          padding: '0.55em 0.8em',
          background: 'rgba(255, 255, 255, 0.95)',
          color: '#1c2b44',
          borderRadius: 10,
          fontSize,
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          boxShadow: '0 1px 0 rgba(0, 0, 0, 0.25)',
        }}
      >
        {showIcon && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: -8,
              top: 12,
              width: 0,
              height: 0,
              borderTop: '6px solid transparent',
              borderBottom: '6px solid transparent',
              borderRight: '10px solid rgba(255, 255, 255, 0.95)',
            }}
          />
        )}
        {children}
      </div>
    </div>
  );
}
