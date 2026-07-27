import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BASE_PALETTE,
  WORLD_SIZE,
  editorColorAt,
  encodeWorldMap,
  loadStaticWorldMap,
  setWorldMap,
  worldMapTiles,
  worldOverlay,
  wrap,
  type Terrain,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { saveWorldMap } from '@/lib/world-authoring';
import { TERRAIN_TILES, fallbackTile, pixelTile } from '@/components/world-tiles';
import { TileArtEditor } from '@/components/admin/tile-art-editor';

/**
 * **マップエディタ (専用画面)** (#421)。
 *
 * 1 タイル 1 画素で色を塗る形にしていたが、**1 ドットに対する操作は現実的でない**
 * (何を塗ったか見えない / どの色がどの地形か分からない)。ワールド画面と同じ
 * **タイルの絵 (パーツ) をそのまま並べて、置いていく**形にする。
 * 内部の持ち方は変わらず 1 タイル 1 バイトの画像で、置いた瞬間に 1 バイト書くだけ。
 *
 * 管理ダッシュボードに埋め込まず別画面にしているのは、地図が広くて縦に長く、
 * 他の管理ツールと同居すると双方が使いにくくなるため。
 */

/** 1 タイルを何 px で描くか (倍率の候補)。パーツが見える大きさが下限。 */
const TILE_PX = [16, 24, 32, 48] as const;
/** 一度に見せるタイル数 (横 × 縦)。広く見せるほど 1 タイルは小さくなる。 */
const COLS = 24;
const ROWS = 16;

/** その地形のパーツ (ワールド画面と同じ絵)。ドット絵 → SVG → 代表色の順に倒す。 */
function partOf(t: Terrain) {
  return pixelTile(t) ?? TERRAIN_TILES[t] ?? fallbackTile(t);
}

export function AdminMap() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const draftRef = useRef<Uint8Array | null>(null);
  const [ready, setReady] = useState(false);
  const [brush, setBrush] = useState<number>(BASE_PALETTE.indexOf('plains'));
  const [tilePx, setTilePx] = useState<number>(24);
  const [grid, setGrid] = useState(true);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [tick, setTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // 地図とパーツの絵は**同じ画面で行き来する**もの (置いてみて絵を直す、の繰り返し)。
  const [tab, setTab] = useState<'map' | 'art'>('map');
  const painting = useRef(false);

  useEffect(() => {
    void loadStaticWorldMap()
      .then(() => {
        const src = worldMapTiles();
        if (!src) throw new Error('地図が読み込めていない');
        // **編集はコピーの上で。** 実体を直接書くと、この画面を開いて置いただけで
        // ワールドの地形が変わる (core は SPA 内で単一インスタンス)。
        draftRef.current = new Uint8Array(src);
        // spawn 付近から始める (いきなり (0,0) の海を見せない)
        const sp = worldOverlay().spawn;
        setOrigin({ x: wrap(sp.x - Math.floor(COLS / 2)), y: wrap(sp.y - Math.floor(ROWS / 2)) });
        setReady(true);
      })
      .catch((e) => setNote(`地図を読めなかった: ${String(e)}`));
  }, []);

  const place = useCallback((cx: number, cy: number) => {
    const tiles = draftRef.current;
    if (!tiles) return;
    const wx = wrap(origin.x + cx);
    const wy = wrap(origin.y + cy);
    if (tiles[wy * WORLD_SIZE + wx] === brush) return;
    tiles[wy * WORLD_SIZE + wx] = brush;
    setDirty(true);
    setTick((n) => n + 1);
  }, [brush, origin]);

  /**
   * **保存せずに、自分のブラウザでだけ試す。**
   *
   * 編集はコピーの上で行うので、置いただけでは `/world` に出ない。これを押すと
   * 読み込み済みの地図と差し替わり、**このタブでワールドを歩いて確かめられる**。
   * 他の人には見えないし、リロードすると元に戻る (保存していないため)。
   */
  const preview = useCallback(() => {
    const tiles = draftRef.current;
    if (!tiles) return;
    setWorldMap({ tiles: new Uint8Array(tiles), size: WORLD_SIZE });
    setNote('ワールドに反映した。この画面のまま /world を開けば歩いて確かめられる (保存はしていないのでリロードで戻る)');
  }, []);

  const save = useCallback(async () => {
    const tiles = draftRef.current;
    if (!session.agent || !tiles) return;
    try {
      setWorldMap({ tiles: new Uint8Array(tiles), size: WORLD_SIZE });
      const bytes = await saveWorldMap(session.agent);
      setDirty(false);
      setNote(`保存した (${(bytes / 1024).toFixed(1)} KB)。サーバーは最大 5 分で拾う`);
    } catch (e) {
      setNote(`保存できなかった: ${String(e)}`);
    }
  }, [session.agent]);

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

  /** 表示中のタイル (tick で再計算)。 */
  const cells = useMemo(() => {
    const tiles = draftRef.current;
    if (!tiles) return [];
    void tick;
    const out: Array<{ cx: number; cy: number; t: Terrain; town: string | null }> = [];
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        const wx = wrap(origin.x + cx);
        const wy = wrap(origin.y + cy);
        const idx = tiles[wy * WORLD_SIZE + wx]!;
        const t = (BASE_PALETTE[idx] ?? 'plains') as Terrain;
        const town = worldOverlay().townMap.get(wy * WORLD_SIZE + wx)?.name ?? null;
        out.push({ cx, cy, t, town });
      }
    }
    return out;
  }, [origin, tick, ready]);

  if (!admin) {
    return (
      <div style={{ padding: '1em' }}>
        <p>この画面は管理者だけが使えます。</p>
        <Link to="/admin">管理ダッシュボードへ</Link>
      </div>
    );
  }

  const W = COLS * tilePx;
  const H = ROWS * tilePx;
  const pan = (dx: number, dy: number) =>
    setOrigin((o) => ({ x: wrap(o.x + dx), y: wrap(o.y + dy) }));

  return (
    <div style={{ padding: '0.8em', maxWidth: '100%' }}>
      <p style={{ fontSize: '0.85em', marginBottom: '0.4em' }}>
        <Link to="/admin">← 管理ダッシュボード</Link>
      </p>
      <h2 style={{ fontSize: '1.05em', margin: '0 0 0.4em' }}>マップエディタ</h2>
      <div style={{ display: 'flex', gap: '0.3em', marginBottom: '0.6em' }}>
        {([['map', '地図を編集'], ['art', 'パーツの絵']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              fontSize: '0.85em', padding: '0.3em 0.8em',
              border: tab === k ? '3px solid var(--color-accent)' : '1px solid var(--color-border)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', margin: '0 0 0.6em', lineHeight: 1.8 }}>
        パーツを選んで置く。置いただけでは何も起きない。<br />
        <strong>ためす</strong> = 自分のブラウザでだけ反映する。この状態で <code>/world</code> を開くと
        歩いて確かめられる。他の人には見えず、リロードすると戻る。<br />
        <strong>みんなに反映</strong> = 保存して全員に配る。移動判定はサーバーが正なので、
        サーバーが拾うまで最大 5 分かかる。
      </p>

      {note && <p style={{ fontSize: '0.85em', color: 'var(--color-accent)' }}>{note}</p>}

      {tab === 'art' ? (
        <TileArtEditor />
      ) : !ready ? (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>地図を読み込んでいる…</p>
      ) : (
        <>
          {/* パーツ選び。色ではなく**実際の絵**を並べる。 */}
          <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5em' }}>
            {BASE_PALETTE.map((t, i) => (
              <button
                key={t}
                type="button"
                onClick={() => setBrush(i)}
                title={t}
                style={{
                  padding: 2, lineHeight: 0, background: 'transparent',
                  border: brush === i ? '3px solid var(--color-accent)' : '1px solid var(--color-border)',
                }}
              >
                <svg width={36} height={36} viewBox="0 0 32 32">{partOf(t)}</svg>
                <div style={{ fontSize: '0.6em', color: 'var(--color-muted)', lineHeight: 1.4 }}>{t}</div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.6em', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.4em', fontSize: '0.8em' }}>
            <label>
              おおきさ{' '}
              <select value={tilePx} onChange={(e) => setTilePx(Number(e.target.value))}>
                {TILE_PX.map((p) => <option key={p} value={p}>{p}px</option>)}
              </select>
            </label>
            <label>
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> グリッド
            </label>
            <span style={{ color: 'var(--color-muted)', fontFamily: 'ui-monospace, monospace' }}>
              ({origin.x}, {origin.y}) 〜 ({wrap(origin.x + COLS - 1)}, {wrap(origin.y + ROWS - 1)})
            </span>
          </div>

          {/* 地図本体 */}
          <div style={{ overflow: 'auto', maxWidth: '100%', border: '2px solid var(--color-border)', width: 'fit-content' }}>
            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${COLS * 32} ${ROWS * 32}`}
              onMouseLeave={() => { painting.current = false; }}
              onMouseUp={() => { painting.current = false; }}
              style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
            >
              {cells.map(({ cx, cy, t }) => (
                <g key={`${cx}-${cy}`} transform={`translate(${cx * 32},${cy * 32})`}>
                  {partOf(t)}
                </g>
              ))}
              {/* 街の目印 (置き換えると消えるので、どこが街か分かるように重ねる) */}
              {cells.filter((c) => c.town).map(({ cx, cy, town }) => (
                <g key={`t-${cx}-${cy}`} transform={`translate(${cx * 32},${cy * 32})`}>
                  <circle cx={16} cy={16} r={5} fill="none" stroke="#f5d442" strokeWidth={2} />
                  <title>{town}</title>
                </g>
              ))}
              {/* グリッド。座標を数えられるよう 8 タイルごとに濃くする。 */}
              {grid && (
                <g pointerEvents="none">
                  {Array.from({ length: COLS + 1 }, (_, i) => (
                    <line
                      key={`v${i}`} x1={i * 32} y1={0} x2={i * 32} y2={ROWS * 32}
                      stroke="#000" strokeOpacity={(origin.x + i) % 8 === 0 ? 0.55 : 0.22} strokeWidth={1}
                    />
                  ))}
                  {Array.from({ length: ROWS + 1 }, (_, i) => (
                    <line
                      key={`h${i}`} x1={0} y1={i * 32} x2={COLS * 32} y2={i * 32}
                      stroke="#000" strokeOpacity={(origin.y + i) % 8 === 0 ? 0.55 : 0.22} strokeWidth={1}
                    />
                  ))}
                </g>
              )}
              {/* 当たり判定 (絵の上に透明の矩形を敷く。絵の中の要素で拾い漏らさない) */}
              {cells.map(({ cx, cy }) => (
                <rect
                  key={`h-${cx}-${cy}`}
                  x={cx * 32} y={cy * 32} width={32} height={32}
                  fill="transparent"
                  onMouseDown={() => { painting.current = true; place(cx, cy); }}
                  onMouseEnter={() => { if (painting.current) place(cx, cy); }}
                />
              ))}
            </svg>
          </div>

          {/* 移動 */}
          <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', marginTop: '0.5em', fontSize: '0.85em' }}>
            {([
              ['←', -COLS, 0], ['→', COLS, 0], ['↑', 0, -ROWS], ['↓', 0, ROWS],
              ['←1', -1, 0], ['→1', 1, 0], ['↑1', 0, -1], ['↓1', 0, 1],
            ] as const).map(([label, dx, dy]) => (
              <button key={label} type="button" onClick={() => pan(dx, dy)} style={{ padding: '0.2em 0.6em' }}>
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const sp = worldOverlay().spawn;
                setOrigin({ x: wrap(sp.x - Math.floor(COLS / 2)), y: wrap(sp.y - Math.floor(ROWS / 2)) });
              }}
              style={{ padding: '0.2em 0.6em' }}
            >
              はじまりの街へ
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.4em', marginTop: '0.6em', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={preview} style={{ fontSize: '0.85em' }}>
              ためす (保存しない)
            </button>
            <button type="button" onClick={() => void save()} disabled={!session.agent} style={{ fontSize: '0.85em' }}>
              みんなに反映 (保存)
            </button>
            <button type="button" onClick={() => void exportGz()} style={{ fontSize: '0.85em' }}>書き出す</button>
            {dirty && <span style={{ fontSize: '0.8em', color: 'var(--color-danger)' }}>未保存の編集あり</span>}
          </div>
        </>
      )}
    </div>
  );
}
