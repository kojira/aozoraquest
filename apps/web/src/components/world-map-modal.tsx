import { useEffect, useMemo, useRef, useState } from 'react';
import { WORLD_SIZE, terrainAt, worldOverlay, type Terrain } from '@aozoraquest/core';

/**
 * 世界地図モーダル (docs/19 — 地図確認機能)。
 *
 * 「地図がないとどこに街があるのか全く分からない」(オーナー報告 2026-07-17、
 * 本番リリース必須要件 #3)。プレビュー期は世界全図をそのまま見せる
 * (W5 の「地図のかけら」はこの画面の開示範囲を絞る機構として後から重ねる)。
 *
 * - 1024×1024 を 4 タイルごとにサンプリングした 256×256 の canvas (約 65k 回の
 *   terrainAt 評価 ≒ 数十 ms)。描画結果はモジュールスコープにキャッシュ
 *   (ワールドは静的データなので一度描けば十分)。
 * - 街 = 金色のドット、現在地 = 点滅する赤マーカー。
 * - タップ/クリックした位置の最寄りの街名を表示 (半径 24 タイル以内)。
 */

const SAMPLE = 4; // 4 タイルごと
const MAP_PX = WORLD_SIZE / SAMPLE; // 256

const TERRAIN_COLORS: Record<Terrain, string> = {
  plains: '#9dd07f',
  grove: '#98cc79',
  forest: '#4f9a4f',
  pond: '#57b7ee',
  water: '#57b7ee',
  mountain: '#a8a294',
  town: '#9dd07f', // 街はドットで別描画 (下地は平地色)
  bridge: '#c98d5a',
};

let cachedMap: ImageData | null = null;

function renderWorldToImageData(): ImageData {
  if (cachedMap) return cachedMap;
  const img = new ImageData(MAP_PX, MAP_PX);
  const data = img.data;
  const colorCache = new Map<string, [number, number, number]>();
  const rgb = (hex: string): [number, number, number] => {
    let c = colorCache.get(hex);
    if (!c) {
      c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      colorCache.set(hex, c);
    }
    return c;
  };
  for (let py = 0; py < MAP_PX; py++) {
    for (let px = 0; px < MAP_PX; px++) {
      const t = terrainAt(px * SAMPLE, py * SAMPLE);
      const [r, g, b] = rgb(TERRAIN_COLORS[t] ?? '#000000');
      const i = (py * MAP_PX + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  cachedMap = img;
  return img;
}

export function WorldMapModal({
  x,
  y,
  onClose,
}: {
  /** プレイヤーの現在地 (ワールド座標) */
  x: number;
  y: number;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const towns = useMemo(() => worldOverlay().towns, []);

  // 地形の描画 (初回は ~数十 ms かかるので effect で。以降はキャッシュ即描)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(renderWorldToImageData(), 0, 0);
    // 街 (金のドット 2px)
    ctx.fillStyle = '#f5d442';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    for (const t of towns) {
      const tx = Math.round(t.x / SAMPLE);
      const ty = Math.round(t.y / SAMPLE);
      ctx.beginPath();
      ctx.arc(tx, ty, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [towns]);

  const spawnName = useMemo(() => worldOverlay().spawn.name, []);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width) * WORLD_SIZE;
    const wy = ((e.clientY - rect.top) / rect.height) * WORLD_SIZE;
    // 最寄りの街 (トーラス距離、24 タイル以内)
    let best: { name: string; d: number } | null = null;
    for (const t of towns) {
      const dx = Math.min(Math.abs(t.x - wx), WORLD_SIZE - Math.abs(t.x - wx));
      const dy = Math.min(Math.abs(t.y - wy), WORLD_SIZE - Math.abs(t.y - wy));
      const d = Math.hypot(dx, dy);
      if (d <= 24 && (!best || d < best.d)) best = { name: t.name, d };
    }
    setPicked(best ? best.name : null);
  };

  return (
    <div
      role="dialog"
      aria-label="世界地図"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1em',
      }}
    >
      <div
        className="dq-window"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 8, maxWidth: 'min(92vw, 520px)', width: '100%' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <strong style={{ fontSize: '0.95em' }}>せかいちず</strong>
          <button type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>
            とじる
          </button>
        </div>
        <div style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            width={MAP_PX}
            height={MAP_PX}
            onClick={pick}
            style={{
              display: 'block',
              width: '100%',
              imageRendering: 'pixelated',
              border: '2px solid var(--color-border)',
              borderRadius: 4,
              cursor: 'crosshair',
            }}
          />
          {/* 現在地マーカー (canvas 外の HTML で点滅) */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: `${(x / WORLD_SIZE) * 100}%`,
              top: `${(y / WORLD_SIZE) * 100}%`,
              width: 10,
              height: 10,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: '#e8566a',
              border: '2px solid #fff',
              boxShadow: '0 0 6px rgba(232, 86, 106, 0.9)',
              animation: 'aq-map-blink 1.1s step-end infinite',
              pointerEvents: 'none',
            }}
          />
          <style>{'@keyframes aq-map-blink { 0%, 60% { opacity: 1; } 61%, 100% { opacity: 0.35; } }'}</style>
        </div>
        <p style={{ margin: '0.5em 0 0', fontSize: '0.75em', color: 'var(--color-muted)', lineHeight: 1.6 }}>
          <span style={{ color: '#e8566a' }}>●</span> いまここ ({x}, {y}) /{' '}
          <span style={{ color: '#c9a92e' }}>●</span> 街 ({towns.length})。地図をタップすると近くの街の名前が出ます。
          {picked ? (
            <strong style={{ color: 'var(--color-fg)', marginLeft: '0.4em' }}>🏘 {picked}</strong>
          ) : (
            <span style={{ marginLeft: '0.4em' }}>はじまりの街: {spawnName}</span>
          )}
        </p>
      </div>
    </div>
  );
}
