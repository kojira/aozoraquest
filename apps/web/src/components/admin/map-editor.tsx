import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BASE_PALETTE,
  PALETTE_MAX,
  TERRAIN_COLORS,
  UNKNOWN_TERRAIN_COLOR,
  WORLD_SIZE,
  encodeWorldMap,
  hasWorldMap,
  loadStaticWorldMap,
  paletteColorAt,
  setMappedTerrain,
  worldMapTiles,
  worldOverlay,
} from '@aozoraquest/core';

/**
 * **マップエディタ** (#421)。地形を 1 タイル 1 バイトの画像として編集する。
 *
 * 地形は 1024×1024 = 100 万タイル。疎な差分だと「広い面積を塗ると保存できない」問題が
 * つきまとうので、**画像そのものを持つ** (生 1 MB → gzip 27 KB)。
 *
 * ここでやること:
 *  - 画素を canvas に描いて、クリック/ドラッグで塗る
 *  - **絵 (パーツ) がまだ無い地形も色で塗れる** — 絵の完成を待つと編集が始められない
 *  - 書き出し (gzip) と PNG 入出力 (外部の絵描きツールで世界を描くため)
 *
 * **保存は別途** — 管理者 PDS への書き込みと edge の読み込みは、権威の一致
 * (移動判定は edge が正) を詰めてから配線する。現状は「編集して書き出す」まで。
 */

/** 画面に出す倍率の候補。1024 は等倍だと大きすぎるので既定は縮小。 */
const ZOOMS = [1, 2, 4, 8] as const;
/** 既定の表示倍率 (1 画素 = 1 タイル)。 */
const DEFAULT_ZOOM = 1;
/** ビューポート (画面に見せる範囲) のタイル数。 */
const VIEW = 512;

export function MapEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(hasWorldMap());
  const [brush, setBrush] = useState(0);
  const [size, setSize] = useState(1);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const painting = useRef(false);

  useEffect(() => {
    if (ready) return;
    void loadStaticWorldMap().then(() => setReady(true)).catch((e) => setNote(`地図を読めなかった: ${String(e)}`));
  }, [ready]);

  /** 画素を canvas に写す。1 タイル = 1 画素で描いてから CSS で拡大する (拡大は GPU に任せる)。 */
  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    const tiles = worldMapTiles();
    if (!cv || !tiles) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(VIEW, VIEW);
    for (let y = 0; y < VIEW; y++) {
      for (let x = 0; x < VIEW; x++) {
        const wx = (origin.x + x) % WORLD_SIZE;
        const wy = (origin.y + y) % WORLD_SIZE;
        const color = paletteColorAt(tiles[wy * WORLD_SIZE + wx]!);
        const o = (y * VIEW + x) * 4;
        img.data[o] = parseInt(color.slice(1, 3), 16);
        img.data[o + 1] = parseInt(color.slice(3, 5), 16);
        img.data[o + 2] = parseInt(color.slice(5, 7), 16);
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // 街の位置を重ねる (どこを編集しているか分かるように)
    ctx.fillStyle = '#f5d442';
    for (const t of worldOverlay().towns) {
      const dx = (t.x - origin.x + WORLD_SIZE) % WORLD_SIZE;
      const dy = (t.y - origin.y + WORLD_SIZE) % WORLD_SIZE;
      if (dx < VIEW && dy < VIEW) ctx.fillRect(dx - 1, dy - 1, 3, 3);
    }
  }, [origin]);

  useEffect(() => { if (ready) redraw(); }, [ready, redraw]);

  const paintAt = useCallback((ev: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const px = Math.floor(((ev.clientX - r.left) / r.width) * VIEW);
    const py = Math.floor(((ev.clientY - r.top) / r.height) * VIEW);
    const half = Math.floor(size / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const wx = (origin.x + px + dx + WORLD_SIZE) % WORLD_SIZE;
        const wy = (origin.y + py + dy + WORLD_SIZE) % WORLD_SIZE;
        setMappedTerrain(wx, wy, brush);
      }
    }
    setDirty(true);
    redraw();
  }, [brush, size, origin, redraw]);

  const exportGz = useCallback(async () => {
    const tiles = worldMapTiles();
    if (!tiles) return;
    const gz = await encodeWorldMap(tiles);
    const url = URL.createObjectURL(new Blob([gz as BlobPart], { type: 'application/gzip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'world-map.bin.gz';
    a.click();
    URL.revokeObjectURL(url);
    setNote(`書き出した (${(gz.length / 1024).toFixed(1)} KB)`);
  }, []);

  /** PNG に書き出す。**外部の絵描きツールで世界を描ける**ようにするため。 */
  const exportPng = useCallback(() => {
    const tiles = worldMapTiles();
    if (!tiles) return;
    const cv = document.createElement('canvas');
    cv.width = WORLD_SIZE;
    cv.height = WORLD_SIZE;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(WORLD_SIZE, WORLD_SIZE);
    for (let i = 0; i < tiles.length; i++) {
      const color = paletteColorAt(tiles[i]!);
      img.data[i * 4] = parseInt(color.slice(1, 3), 16);
      img.data[i * 4 + 1] = parseInt(color.slice(3, 5), 16);
      img.data[i * 4 + 2] = parseInt(color.slice(5, 7), 16);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    cv.toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'world-map.png';
      a.click();
      URL.revokeObjectURL(url);
    });
    setNote('PNG に書き出した (色 → 地形の対応はパレットの色と一致させること)');
  }, []);

  const swatches = Array.from({ length: PALETTE_MAX }, (_, i) => i)
    .filter((i) => i < BASE_PALETTE.length || i === BASE_PALETTE.length);

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>マップエディタ</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.5em' }}>
        地形を 1 タイル 1 画素として編集する。<strong>移動判定はサーバー (edge) が正</strong>なので、
        保存して edge が読むまでゲームには反映されない。
      </p>

      {note && <p style={{ fontSize: '0.85em', color: 'var(--color-accent)' }}>{note}</p>}

      {!ready ? (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>地図を読み込んでいる…</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5em' }}>
            {swatches.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setBrush(i)}
                title={BASE_PALETTE[i] ?? `未定義 (index ${i})`}
                style={{
                  width: 28, height: 28, padding: 0,
                  background: i < BASE_PALETTE.length ? paletteColorAt(i) : UNKNOWN_TERRAIN_COLOR,
                  border: brush === i ? '3px solid var(--color-accent)' : '1px solid var(--color-border)',
                }}
              />
            ))}
            <label style={{ fontSize: '0.8em' }}>
              ふとさ{' '}
              <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {[1, 3, 5, 9, 17].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8em' }}>
              ばいりつ{' '}
              <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                {ZOOMS.map((z) => <option key={z} value={z}>{z}x</option>)}
              </select>
            </label>
          </div>

          <div style={{ overflow: 'auto', maxWidth: '100%', border: '2px solid var(--color-border)' }}>
            <canvas
              ref={canvasRef}
              width={VIEW}
              height={VIEW}
              onMouseDown={(e) => { painting.current = true; paintAt(e); }}
              onMouseMove={(e) => { if (painting.current) paintAt(e); }}
              onMouseUp={() => { painting.current = false; }}
              onMouseLeave={() => { painting.current = false; }}
              style={{
                width: VIEW * zoom, height: VIEW * zoom,
                imageRendering: 'pixelated', cursor: 'crosshair', display: 'block',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', marginTop: '0.5em', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
              左上 ({origin.x}, {origin.y}) / {VIEW}×{VIEW} タイル
            </span>
            {([['←', -VIEW, 0], ['→', VIEW, 0], ['↑', 0, -VIEW], ['↓', 0, VIEW]] as const).map(([label, dx, dy]) => (
              <button
                key={label}
                type="button"
                onClick={() => setOrigin((o) => ({
                  x: (o.x + dx + WORLD_SIZE) % WORLD_SIZE,
                  y: (o.y + dy + WORLD_SIZE) % WORLD_SIZE,
                }))}
                style={{ fontSize: '0.85em', padding: '0.2em 0.6em' }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.4em', marginTop: '0.5em' }}>
            <button type="button" onClick={() => void exportGz()} style={{ fontSize: '0.85em' }}>
              書き出す (gzip)
            </button>
            <button type="button" onClick={exportPng} style={{ fontSize: '0.85em' }}>
              PNG で書き出す
            </button>
            {dirty && <span style={{ fontSize: '0.8em', color: 'var(--color-danger)' }}>未保存の編集あり</span>}
          </div>

          <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.5em', lineHeight: 1.7 }}>
            絵 (パーツ) がまだ無い地形も色で塗れる。パレットは 1 バイト = <strong>256 種</strong>まで持てて、
            このコードが知らない地形は安全な既定値に倒れるので、
            <strong>エディタ側で先に地形を増やしても壊れない</strong>。
          </p>
        </>
      )}
    </section>
  );
}
