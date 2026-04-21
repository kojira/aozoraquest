import type { ReactNode } from 'react';

/**
 * 自分の発言。SpiritBubble と対をなす、右寄せの吹き出し。
 */
export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div
        style={{
          position: 'relative',
          maxWidth: '80%',
          padding: '0.55em 0.8em',
          background: 'rgba(159, 215, 255, 0.95)',
          color: '#0b1b3a',
          borderRadius: 10,
          fontSize: '0.95em',
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          boxShadow: '0 1px 0 rgba(0, 0, 0, 0.25)',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: -8,
            top: 12,
            width: 0,
            height: 0,
            borderTop: '6px solid transparent',
            borderBottom: '6px solid transparent',
            borderLeft: '10px solid rgba(159, 215, 255, 0.95)',
          }}
        />
        {children}
      </div>
    </div>
  );
}
