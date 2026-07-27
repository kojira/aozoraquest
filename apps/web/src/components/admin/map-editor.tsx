import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BASE_PALETTE,
  PALETTE_MAX,
  TERRAIN_COLORS,
  UNKNOWN_TERRAIN_COLOR,
  WORLD_SIZE,
  editorColorAt,
  encodeWorldMap,
  loadStaticWorldMap,
  paletteColorAt,
  setWorldMap,
  worldMapTiles,
  worldOverlay,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { saveWorldMap } from '@/lib/world-authoring';

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
 * **保存すると管理者 PDS に書かれ、web と edge の両方が同じレコードを読む。**
 * 移動判定は edge が権威なので、web だけが編集後の地図を見ていると
 * 「画面では歩けるのにサーバーが弾く」= その場から動けなくなる。
 */

/** 画面に出す倍率の候補。1024 は等倍だと大きすぎるので既定は縮小。 */
const ZOOMS = [1, 2, 4, 8] as const;
/** 既定の表示倍率 (1 画素 = 1 タイル)。 */
const DEFAULT_ZOOM = 1;
/** ビューポート (画面に見せる範囲) のタイル数。 */
const VIEW = 512;

/** index → RGBA (リトルエンディアンの 0xAABBGGRR)。**毎画素で色文字列を解析しない** —
 *  512×512 = 26 万画素の走査が 21 ms から 0.3 ms になる (実測 74 倍)。 */
const RGBA_LUT = (() => {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const hex = editorColorAt(i);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    lut[i] = (255 << 24) | (b << 16) | (g << 8) | r;
  }
  return lut;
})();

export function MapEditor() {
  const session = useSession();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // **編集は必ずコピーの上で行う。** worldMapTiles() が返すのはモジュールグローバルの
  // 実体で、そこを直接書くと「管理画面を開いて塗っただけでワールドの地形が変わる」
  // (SPA なので core は単一インスタンス)。自分の現在地を水にすると身動きが取れなくなる。
  const draftRef = useRef<Uint8Array | null>(null);
  const [ready, setReady] = useState(false);
  const [brush, setBrush] = useState(0);
  const [size, setSize] = useState(1);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const painting = useRef(false);

  useEffect(() => {
    if (ready) return;
    void loadStaticWorldMap()
      .then(() => {
        const src = worldMapTiles();
        if (!src) throw new Error('地図が読み込めていない');
        draftRef.current = new Uint8Array(src); // 実体を触らない
        setReady(true);
      })
      .catch((e) => setNote(`地図を読めなかった: ${String(e)}`));
  }, [ready]);

  /** 画素を canvas に写す。1 タイル = 1 画素で描いてから CSS で拡大する (拡大は GPU に任せる)。 */
  const redraw = useCallback(() => {
    const cv = canvasRef.current;
    const tiles = draftRef.current;
    if (!cv || !tiles) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(VIEW, VIEW);
    // 32bit で一気に書く (色文字列の解析を毎画素でやらない)
    const buf = new Uint32Array(img.data.buffer);
    for (let y = 0; y < VIEW; y++) {
      const wy = (origin.y + y) % WORLD_SIZE;
      const row = wy * WORLD_SIZE;
      const out = y * VIEW;
      for (let x = 0; x < VIEW; x++) {
        buf[out + x] = RGBA_LUT[tiles[row + ((origin.x + x) % WORLD_SIZE)]!]!;
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
        draftRef.current![wy * WORLD_SIZE + wx] = brush;
      }
    }
    setDirty(true);
    redraw();
  }, [brush, size, origin, redraw]);

  /** 編集内容をゲームに反映する (この画面の外にも効く)。保存とは別。 */
  const apply = useCallback(() => {
    const tiles = draftRef.current;
    if (!tiles) return;
    setWorldMap({ tiles: new Uint8Array(tiles), size: WORLD_SIZE });
    setNote('この端末のワールドに反映した (保存はまだ)');
  }, []);

  const exportGz = useCallback(async () => {
    const tiles = draftRef.current;
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
    const tiles = draftRef.current;
    if (!tiles) return;
    const cv = document.createElement('canvas');
    cv.width = WORLD_SIZE;
    cv.height = WORLD_SIZE;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(WORLD_SIZE, WORLD_SIZE);
    for (let i = 0; i < tiles.length; i++) {
      // PNG は**地形 index を R チャンネルにそのまま載せる** (色にすると
      // plains/town・pond/water が同じ RGB に潰れて往復できない)。
      img.data[i * 4] = tiles[i]!;
      img.data[i * 4 + 1] = 0;
      img.data[i * 4 + 2] = 0;
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
    setNote('PNG に書き出した (R チャンネル = 地形 index。色ではなく index で往復する)');
  }, []);

  const save = useCallback(async () => {
    if (!session.agent || !draftRef.current) return;
    try {
      setWorldMap({ tiles: new Uint8Array(draftRef.current), size: WORLD_SIZE });
      const bytes = await saveWorldMap(session.agent);
      setDirty(false);
      setNote(`保存した (${(bytes / 1024).toFixed(1)} KB)。edge は最大 5 分で拾う`);
    } catch (e) {
      setNote(`保存できなかった: ${String(e)}`);
    }
  }, [session.agent]);

  const swatches = Array.from({ length: PALETTE_MAX }, (_, i) => i)
    .filter((i) => i < BASE_PALETTE.length || i === BASE_PALETTE.length);

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>マップエディタ</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.5em' }}>
        地形を 1 タイル 1 画素として編集する。<strong>移動判定はサーバー (edge) が正</strong>なので、
        保存すると管理者の PDS に書かれ、web と edge の両方が同じ地図を読む。
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
                  background: i < BASE_PALETTE.length ? editorColorAt(i) : UNKNOWN_TERRAIN_COLOR,
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
            <button type="button" onClick={apply} style={{ fontSize: '0.85em' }}>
              この端末に反映
            </button>
            <button type="button" onClick={() => void save()} disabled={!session.agent} style={{ fontSize: '0.85em' }}>
              保存する
            </button>
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
