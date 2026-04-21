import type { CSSProperties } from 'react';

interface SpiritIconProps {
  size?: number;
  style?: CSSProperties;
  /** 目をつむった表情 (読み込み中など) */
  sleeping?: boolean;
}

/**
 * 精霊マスコット。青空の化身としての小さな雲の精 (SVG、依存なし)。
 * 丸みのあるシルエット、2 つの目、薄い頬、まわりに小さな星。
 */
export function SpiritIcon({ size = 48, style, sleeping = false }: SpiritIconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="精霊"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {/* まわりの淡い光 */}
      <circle cx="50" cy="54" r="44" fill="rgba(159, 215, 255, 0.18)" />

      {/* 雲のかたまり (体) */}
      <g>
        <circle cx="32" cy="58" r="18" fill="#f6fbff" />
        <circle cx="50" cy="48" r="24" fill="#f6fbff" />
        <circle cx="68" cy="58" r="18" fill="#f6fbff" />
        <ellipse cx="50" cy="66" rx="30" ry="14" fill="#f6fbff" />
      </g>
      {/* 下側のやわらかい影 */}
      <ellipse cx="50" cy="72" rx="26" ry="4" fill="rgba(35, 70, 120, 0.18)" />

      {/* ほっぺ */}
      <circle cx="35" cy="58" r="4" fill="#ffb8c5" opacity="0.5" />
      <circle cx="65" cy="58" r="4" fill="#ffb8c5" opacity="0.5" />

      {/* 目 */}
      {sleeping ? (
        <>
          <path d="M 39 52 Q 43 55 47 52" stroke="#1c2b44" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M 53 52 Q 57 55 61 52" stroke="#1c2b44" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="42" cy="52" rx="2.2" ry="3" fill="#1c2b44" />
          <ellipse cx="58" cy="52" rx="2.2" ry="3" fill="#1c2b44" />
          <circle cx="43" cy="51" r="0.8" fill="#ffffff" />
          <circle cx="59" cy="51" r="0.8" fill="#ffffff" />
        </>
      )}

      {/* 口 (うっすら) */}
      <path d="M 46 60 Q 50 62.5 54 60" stroke="#1c2b44" strokeWidth="1.4" fill="none" strokeLinecap="round" />

      {/* 小さな星 */}
      <g fill="#ffffff" opacity="0.85">
        <circle cx="14" cy="30" r="1.3" />
        <circle cx="86" cy="34" r="1.6" />
        <circle cx="22" cy="82" r="1.1" />
        <circle cx="82" cy="78" r="1.1" />
      </g>
    </svg>
  );
}
