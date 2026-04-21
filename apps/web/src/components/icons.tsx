import type { CSSProperties } from 'react';

/**
 * Material Design Icons の filled/outlined パスを使ったシンプル SVG 群。
 * viewBox は全て 24×24、色は currentColor 継承。
 */

interface IconProps {
  size?: number;
  style?: CSSProperties;
}

function base({ size = 24, style }: IconProps) {
  return {
    width: size,
    height: size,
    display: 'block',
    fill: 'currentColor',
    ...style,
  } satisfies CSSProperties;
}

export function HomeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" style={base(props)} aria-hidden>
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
    </svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" style={base(props)} aria-hidden>
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" style={base(props)} aria-hidden>
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" style={base(props)} aria-hidden>
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

/**
 * ブルスコンのナビ用アイコン。中央のマスコットだけをコンパクトに描く。
 * (マスコット本体の SpiritIcon は詳細すぎるので小サイズ用に別実装)
 */
export function BrusukonIcon({ size = 24, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', ...style }} aria-hidden>
      <g fill="currentColor">
        <circle cx="7" cy="14" r="4" />
        <circle cx="12" cy="11" r="5.2" />
        <circle cx="17" cy="14" r="4" />
        <ellipse cx="12" cy="16.5" rx="7" ry="3" />
      </g>
      <ellipse cx="10.2" cy="12" rx="0.9" ry="1.2" fill="#0e1b33" />
      <ellipse cx="13.8" cy="12" rx="0.9" ry="1.2" fill="#0e1b33" />
      <path d="M10.8 14.4 Q12 15.2 13.2 14.4" stroke="#0e1b33" strokeWidth="0.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}
