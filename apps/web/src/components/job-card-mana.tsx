/** JobCard のマナコスト / タップシンボルの SVG 描画。 */

import type { Color, ManaCost } from '@aozoraquest/core';
import { COLORS } from '@aozoraquest/core';

/**
 * カードに表示するマナコスト列。SVG ネイティブ (rasterize 対応)。
 * cost に含まれる generic を先頭、色マナを WUBRG 順で並べる。
 * rightX (右端) または leftX (左端) のどちらかを指定して整列。 */
export function ManaCostSvgRow({ cost, tap, rightX, leftX, cy, symbolSize }: {
  cost: ManaCost;
  /** タップシンボル (T) を mana の前に描画する。クリーチャー/アーティファクトの起動コスト用。 */
  tap?: boolean;
  rightX?: number;
  leftX?: number;
  cy: number;
  symbolSize: number;
}) {
  type Item =
    | { key: string; kind: 'tap' }
    | { key: string; kind: 'mana'; color: Color | 'generic'; value?: number };
  const items: Item[] = [];
  if (tap) items.push({ key: 'T', kind: 'tap' });
  if (cost.generic && cost.generic > 0) {
    items.push({ key: 'g', kind: 'mana', color: 'generic', value: cost.generic });
  }
  for (const c of COLORS) {
    const n = cost[c] ?? 0;
    for (let i = 0; i < n; i++) items.push({ key: `${c}${i}`, kind: 'mana', color: c });
  }
  if (items.length === 0) return null;
  const gap = 4;
  const totalWidth = items.length * symbolSize + (items.length - 1) * gap;
  const startX = leftX !== undefined ? leftX : (rightX !== undefined ? rightX - totalWidth : 0);
  return (
    <g>
      {items.map((item, idx) => {
        const cx = startX + idx * (symbolSize + gap);
        const cyTop = cy - symbolSize / 2;
        if (item.kind === 'tap') {
          return <TapSymbolSvg key={item.key} x={cx} y={cyTop} size={symbolSize} />;
        }
        return (
          <ManaSymbolSvg
            key={item.key}
            color={item.color}
            {...(item.value !== undefined ? { value: item.value } : {})}
            x={cx}
            y={cyTop}
            size={symbolSize}
          />
        );
      })}
    </g>
  );
}

/** タップシンボル (MTG の {T})。傾いた矢印で「タップして起動」を示す。 */
function TapSymbolSvg({ x, y, size }: { x: number; y: number; size: number }) {
  const r = size / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx={r} cy={r} r={r * 0.97} fill="#3a2818" />
      <circle cx={r} cy={r} r={r * 0.84} fill="#f4ead0" />
      <ellipse cx={r * 0.78} cy={r * 0.68} rx={r * 0.32} ry={r * 0.18} fill="rgba(255,255,255,0.5)" />
      {/* 傾いた T 字 (回転矢印を象徴) */}
      <g transform={`rotate(45 ${r} ${r})`} fill="#3a2818">
        <rect x={r - r * 0.55} y={r - r * 0.7} width={r * 1.1} height={r * 0.22} rx={r * 0.06} />
        <rect x={r - r * 0.12} y={r - r * 0.55} width={r * 0.24} height={r * 1.1} rx={r * 0.06} />
      </g>
    </g>
  );
}

/** マナシンボル 1 個を SVG <g> として描く。color 別の背景色 + シンボル glyph。 */
function ManaSymbolSvg({ color, value, x, y, size }: {
  color: Color | 'generic';
  value?: number;
  x: number;
  y: number;
  size: number;
}) {
  const bg: Record<Color | 'generic', string> = {
    W: '#f4ead0', U: '#7fb6e0', B: '#2a1f2a', R: '#c84a36', G: '#3f7a4a', generic: '#a8a298',
  };
  const ring: Record<Color | 'generic', string> = {
    W: '#8c7a40', U: '#234a70', B: '#0a0a0a', R: '#5a1a10', G: '#1c3a22', generic: '#3a3530',
  };
  const ic: Record<Color | 'generic', string> = {
    W: '#5a4810', U: '#0e2a4a', B: '#e0c8c8', R: '#fff0c0', G: '#e8f0d0', generic: '#1a1a1a',
  };
  const r = size / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx={r} cy={r} r={r * 0.97} fill={ring[color]} />
      <circle cx={r} cy={r} r={r * 0.84} fill={bg[color]} />
      <ellipse cx={r * 0.78} cy={r * 0.68} rx={r * 0.32} ry={r * 0.18} fill="rgba(255,255,255,0.35)" />
      <ManaGlyph color={color} value={value} fg={ic[color]} bg={bg[color]} cx={r} cy={r} r={r} />
    </g>
  );
}

function ManaGlyph({ color, value, fg, bg, cx, cy, r }: {
  color: Color | 'generic';
  value: number | undefined;
  fg: string;
  bg: string;
  cx: number;
  cy: number;
  r: number;
}) {
  const s = r / 12; // scale (viewBox 24×24 → 実 size)
  const tx = (n: number) => cx + (n - 12) * s;
  const ty = (n: number) => cy + (n - 12) * s;
  switch (color) {
    case 'W':
      return (
        <g fill={fg}>
          <circle cx={tx(12)} cy={ty(12)} r={2.8 * s} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <rect key={deg}
              x={tx(11.2)} y={ty(3.6)} width={1.6 * s} height={3.6 * s}
              transform={`rotate(${deg} ${cx} ${cy})`} rx={0.6 * s} />
          ))}
        </g>
      );
    case 'U':
      return (
        <path
          d={`M ${tx(12)} ${ty(4.5)} C ${tx(12)} ${ty(4.5)}, ${tx(6)} ${ty(11)}, ${tx(6)} ${ty(14.8)} C ${tx(6)} ${ty(17.8)}, ${tx(8.7)} ${ty(19.8)}, ${tx(12)} ${ty(19.8)} C ${tx(15.3)} ${ty(19.8)}, ${tx(18)} ${ty(17.8)}, ${tx(18)} ${ty(14.8)} C ${tx(18)} ${ty(11)}, ${tx(12)} ${ty(4.5)}, ${tx(12)} ${ty(4.5)} Z`}
          fill={fg}
        />
      );
    case 'B':
      return (
        <g fill={fg}>
          <path d={`M ${tx(12)} ${ty(5)} C ${tx(8)} ${ty(5)}, ${tx(5.5)} ${ty(8)}, ${tx(5.5)} ${ty(11.5)} C ${tx(5.5)} ${ty(13.6)}, ${tx(6.6)} ${ty(15.4)}, ${tx(8.3)} ${ty(16.4)} L ${tx(8.3)} ${ty(18.5)} L ${tx(10)} ${ty(18.5)} L ${tx(10)} ${ty(17.2)} L ${tx(11.2)} ${ty(17.2)} L ${tx(11.2)} ${ty(18.5)} L ${tx(12.8)} ${ty(18.5)} L ${tx(12.8)} ${ty(17.2)} L ${tx(14)} ${ty(17.2)} L ${tx(14)} ${ty(18.5)} L ${tx(15.7)} ${ty(18.5)} L ${tx(15.7)} ${ty(16.4)} C ${tx(17.4)} ${ty(15.4)}, ${tx(18.5)} ${ty(13.6)}, ${tx(18.5)} ${ty(11.5)} C ${tx(18.5)} ${ty(8)}, ${tx(16)} ${ty(5)}, ${tx(12)} ${ty(5)} Z`} />
          <circle cx={tx(9.3)} cy={ty(11.5)} r={1.6 * s} fill={bg} />
          <circle cx={tx(14.7)} cy={ty(11.5)} r={1.6 * s} fill={bg} />
        </g>
      );
    case 'R':
      return (
        <path
          d={`M ${tx(12)} ${ty(4)} C ${tx(13)} ${ty(7)}, ${tx(15)} ${ty(9)}, ${tx(15)} ${ty(11.5)} C ${tx(15)} ${ty(13)}, ${tx(14)} ${ty(13.6)}, ${tx(13.6)} ${ty(13.4)} C ${tx(13.8)} ${ty(12)}, ${tx(13.2)} ${ty(10.5)}, ${tx(11.8)} ${ty(10)} C ${tx(12)} ${ty(12)}, ${tx(10.5)} ${ty(13)}, ${tx(9)} ${ty(14.5)} C ${tx(7.8)} ${ty(15.8)}, ${tx(7.5)} ${ty(17.4)}, ${tx(8.4)} ${ty(18.6)} C ${tx(9.3)} ${ty(19.6)}, ${tx(11)} ${ty(20)}, ${tx(12.5)} ${ty(20)} C ${tx(16)} ${ty(20)}, ${tx(17.6)} ${ty(16.8)}, ${tx(17)} ${ty(14)} C ${tx(16.3)} ${ty(10.7)}, ${tx(13.8)} ${ty(7.5)}, ${tx(12)} ${ty(4)} Z`}
          fill={fg}
        />
      );
    case 'G':
      return (
        <path
          d={`M ${tx(12)} ${ty(4.5)} C ${tx(17)} ${ty(6)}, ${tx(19)} ${ty(10)}, ${tx(18)} ${ty(15)} C ${tx(17.2)} ${ty(18.5)}, ${tx(14)} ${ty(19.8)}, ${tx(11)} ${ty(19.5)} C ${tx(7.5)} ${ty(19)}, ${tx(5.4)} ${ty(16)}, ${tx(5.8)} ${ty(12.5)} C ${tx(6.2)} ${ty(9)}, ${tx(8)} ${ty(6)}, ${tx(12)} ${ty(4.5)} Z`}
          fill={fg}
        />
      );
    case 'generic':
      return (
        <text x={cx} y={cy + r * 0.05}
              fontSize={r * 1.1} fontWeight="800"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif"
              textAnchor="middle" dominantBaseline="central" fill={fg}>
          {value ?? '?'}
        </text>
      );
  }
}
