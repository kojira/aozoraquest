import type { StatVector } from '@aozoraquest/core';

interface RadarChartProps {
  stats: StatVector;
  /** 図全体の一辺 (px) */
  size?: number;
  /** 最大値 (0..max の範囲で描画)。ステータスは 0-100 想定。 */
  max?: number;
}

const AXES: Array<{ key: keyof StatVector; label: string; color: string }> = [
  { key: 'atk', label: '攻', color: 'var(--color-atk)' },
  { key: 'def', label: '守', color: 'var(--color-def)' },
  { key: 'agi', label: '速', color: 'var(--color-agi)' },
  { key: 'int', label: '知', color: 'var(--color-int)' },
  { key: 'luk', label: '運', color: 'var(--color-luk)' },
];

/**
 * 5 軸レーダーチャート。純粋 SVG、依存なし。
 * 軸は 12 時位置を起点に時計回りに 72°ずつ (攻・守・速・知・運)。
 */
export function RadarChart({ stats, size = 220, max = 100 }: RadarChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;

  // 軸方向の単位ベクトル (12 時を 0°、時計回り)
  const axisVecs = AXES.map((_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });

  const pointFor = (value: number, scale: number) => {
    const r = (Math.max(0, Math.min(max, value)) / max) * radius * scale;
    return axisVecs.map((v) => ({ x: cx + v.x * r, y: cy + v.y * r }));
  };

  // 背景の目盛 (25/50/75/100)
  const gridLevels = [0.25, 0.5, 0.75, 1];

  // 実データの多角形
  const valuePoints = AXES.map((a, i) => {
    const v = (Math.max(0, Math.min(max, stats[a.key])) / max) * radius;
    return { x: cx + axisVecs[i]!.x * v, y: cy + axisVecs[i]!.y * v };
  });
  const valuePath = valuePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z';

  // ラベル位置 (外周の少し外)
  const labelPoints = axisVecs.map((v) => ({ x: cx + v.x * (radius + 16), y: cy + v.y * (radius + 16) }));

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="ステータスのレーダーチャート"
      style={{ display: 'block' }}
    >
      {/* グリッド (5 段階の五角形) */}
      {gridLevels.map((level, idx) => {
        const pts = pointFor(level * max, 1);
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + ' Z';
        return (
          <path
            key={idx}
            d={d}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={1}
          />
        );
      })}

      {/* 軸線 */}
      {axisVecs.map((v, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={cx + v.x * radius}
          y2={cy + v.y * radius}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={1}
        />
      ))}

      {/* データ多角形 */}
      <path d={valuePath} fill="rgba(159, 215, 255, 0.35)" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />

      {/* 各頂点の点 */}
      {AXES.map((a, i) => {
        const p = valuePoints[i]!;
        return <circle key={a.key} cx={p.x} cy={p.y} r={3} fill={a.color} />;
      })}

      {/* ラベル */}
      {AXES.map((a, i) => {
        const p = labelPoints[i]!;
        return (
          <text
            key={a.key}
            x={p.x}
            y={p.y}
            fontSize={size * 0.07}
            fill="#ffffff"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ userSelect: 'none' }}
          >
            {a.label} {stats[a.key]}
          </text>
        );
      })}
    </svg>
  );
}
