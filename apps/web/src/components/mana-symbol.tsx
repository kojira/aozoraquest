import { COLORS, type Color, type ManaCost } from '@aozoraquest/core';
import type { CSSProperties } from 'react';

/**
 * MTG 風マナシンボル。6 種類 (W/U/B/R/G + generic) を SVG で抽象化。
 *
 * 各色のビジュアル:
 *   W (white):   太陽十字 + クリーム背景
 *   U (blue):    水滴 + 水色背景
 *   B (black):   髑髏 + 黒紫背景
 *   R (red):     炎 + 暗赤背景
 *   G (green):   葉 + 深緑背景
 *   generic:     数字 + 灰背景 (任意色マナの数値表現、{1} {2} {3} 等)
 *
 * 商標安全な抽象シンボル (MTG 純正アイコンを直接使わない)。
 */
export type ManaSymbolType = Color | 'generic';

export interface ManaSymbolProps {
  type: ManaSymbolType;
  /** generic 専用: 数字を中央表示する。他色では無視。 */
  value?: number;
  /** ピクセルサイズ (正方形)。 */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

const BG: Record<ManaSymbolType, string> = {
  W: '#f4ead0',
  U: '#7fb6e0',
  B: '#2a1f2a',
  R: '#c84a36',
  G: '#3f7a4a',
  generic: '#a8a298',
};

const RING: Record<ManaSymbolType, string> = {
  W: '#8c7a40',
  U: '#234a70',
  B: '#0a0a0a',
  R: '#5a1a10',
  G: '#1c3a22',
  generic: '#3a3530',
};

const ICON: Record<ManaSymbolType, string> = {
  W: '#5a4810',
  U: '#0e2a4a',
  B: '#e0c8c8',
  R: '#fff0c0',
  G: '#e8f0d0',
  generic: '#1a1a1a',
};

export function ManaSymbol({ type, value, size = 22, className, style }: ManaSymbolProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-label={ariaLabelOf(type, value)}
      role="img"
    >
      {/* リング (外側枠) */}
      <circle cx="12" cy="12" r="11.2" fill={RING[type]} />
      {/* 本体背景 */}
      <circle cx="12" cy="12" r="9.6" fill={BG[type]} />
      {/* ハイライト (左上のキラ、立体感) */}
      <ellipse cx="9" cy="8" rx="3.4" ry="1.8" fill="rgba(255,255,255,0.35)" />
      {/* 色別シンボル */}
      <ManaGlyph type={type} value={value} color={ICON[type]} />
    </svg>
  );
}

function ariaLabelOf(type: ManaSymbolType, value: number | undefined): string {
  if (type === 'generic') return `generic mana ${value ?? '?'}`;
  const labels: Record<Color, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
  return `${labels[type]} mana`;
}

function ManaGlyph({ type, value, color }: { type: ManaSymbolType; value: number | undefined; color: string }) {
  switch (type) {
    case 'W': // 太陽 (8 光線 + 中央円) — 秩序と光の象徴
      return (
        <g fill={color}>
          <circle cx="12" cy="12" r="2.8" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <rect
              key={deg}
              x="11.2"
              y="3.6"
              width="1.6"
              height="3.6"
              transform={`rotate(${deg} 12 12)`}
              rx="0.6"
            />
          ))}
        </g>
      );
    case 'U': // 水滴 (drop)
      return (
        <path
          d="M 12 4.5 C 12 4.5, 6 11, 6 14.8 C 6 17.8, 8.7 19.8, 12 19.8 C 15.3 19.8, 18 17.8, 18 14.8 C 18 11, 12 4.5, 12 4.5 Z"
          fill={color}
        />
      );
    case 'B': // 髑髏 (シンプルなシルエット、目 2 つ + 顎)
      return (
        <g fill={color}>
          <path d="M 12 5 C 8 5, 5.5 8, 5.5 11.5 C 5.5 13.6, 6.6 15.4, 8.3 16.4 L 8.3 18.5 L 10 18.5 L 10 17.2 L 11.2 17.2 L 11.2 18.5 L 12.8 18.5 L 12.8 17.2 L 14 17.2 L 14 18.5 L 15.7 18.5 L 15.7 16.4 C 17.4 15.4, 18.5 13.6, 18.5 11.5 C 18.5 8, 16 5, 12 5 Z" />
          <circle cx="9.3" cy="11.5" r="1.6" fill={BG.B} />
          <circle cx="14.7" cy="11.5" r="1.6" fill={BG.B} />
          <rect x="11.2" y="13.3" width="1.6" height="1.6" fill={BG.B} />
        </g>
      );
    case 'R': // 炎
      return (
        <path
          d="M 12 4 C 13 7, 15 9, 15 11.5 C 15 13, 14 13.6, 13.6 13.4 C 13.8 12, 13.2 10.5, 11.8 10 C 12 12, 10.5 13, 9 14.5 C 7.8 15.8, 7.5 17.4, 8.4 18.6 C 9.3 19.6, 11 20, 12.5 20 C 16 20, 17.6 16.8, 17 14 C 16.3 10.7, 13.8 7.5, 12 4 Z"
          fill={color}
        />
      );
    case 'G': // 葉
      return (
        <g fill={color}>
          <path d="M 12 4.5 C 17 6, 19 10, 18 15 C 17.2 18.5, 14 19.8, 11 19.5 C 7.5 19, 5.4 16, 5.8 12.5 C 6.2 9, 8 6, 12 4.5 Z" />
          <path
            d="M 12 6 C 11 9, 10.5 12, 10.7 15.8"
            stroke={BG.G}
            strokeWidth="0.9"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    case 'generic': // 数字
      return (
        <text
          x="12"
          y="12"
          fontSize="13"
          fontWeight="800"
          fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif"
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
        >
          {value ?? '?'}
        </text>
      );
  }
}

/**
 * ManaCost を WUBRG + generic 順で並べて表示。
 * generic は先頭、色マナは 1 枚 = 1 シンボル (N 個分繰り返し)。
 */
export interface ManaCostRowProps {
  cost: ManaCost;
  size?: number;
  gap?: number;
  className?: string;
  style?: CSSProperties;
}

export function ManaCostRow({ cost, size = 22, gap = 2, className, style }: ManaCostRowProps) {
  const symbols: Array<{ type: ManaSymbolType; value?: number; key: string }> = [];
  const generic = cost.generic ?? 0;
  if (generic > 0) {
    symbols.push({ type: 'generic', value: generic, key: 'g' });
  }
  for (const c of COLORS) {
    const n = cost[c] ?? 0;
    for (let i = 0; i < n; i++) {
      symbols.push({ type: c, key: `${c}${i}` });
    }
  }
  if (symbols.length === 0) return null;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        ...style,
      }}
    >
      {symbols.map((s) => (
        <ManaSymbol
          key={s.key}
          type={s.type}
          size={size}
          {...(s.value !== undefined ? { value: s.value } : {})}
        />
      ))}
    </span>
  );
}
