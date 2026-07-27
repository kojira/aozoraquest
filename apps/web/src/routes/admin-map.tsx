import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BASE_PALETTE,
  WORLD_SIZE,
  MAX_TOWN_NAME,
  editorColorAt,
  encodeWorldMap,
  setTownOverrides,
  worldTownOverrides,
  setWorldMap,
  worldMapTiles,
  worldOverlay,
  wrap,
  type Terrain,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { loadAuthoredWorld, saveWorldMap } from '@/lib/world-authoring';
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
  // **街モード**。地形の「街」パーツを置いただけでは、名前も店も宿も無い
  // 「街に見えるだけの通れるマス」にしかならない。街そのものは別データなので、
  // 置くときに名前を聞いて差分に積む。
  const [townMode, setTownMode] = useState(false);
  const [townTick, setTownTick] = useState(0);
  const painting = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // **保存済みの地図を読む。** 同梱の地図を読んでいたため、編集して保存したあと
    // この画面を開き直すと**編集が消えて見え、そのまま保存すると上書きされていた**。
    // 地図の出所は保存経路と必ず同じにする。
    void loadAuthoredWorld(session.agent ?? null)
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
    // agent が入るのは復元後なので、それを待って読む (未ログインだと保存済みを読めない)。
  }, [session.agent]);

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
   * 街を置く / 消す。**地形と街データの両方を動かす。**
   * 地形だけ「街」にすると名前も店も宿も無いマスになり、街データだけ足すと
   * 地形が海のままの街ができる。片方だけ触れないようにここでまとめる。
   */
  const editTown = useCallback((cx: number, cy: number) => {
    const tiles = draftRef.current;
    if (!tiles) return;
    const wx = wrap(origin.x + cx);
    const wy = wrap(origin.y + cy);
    const existing = worldOverlay().townMap.get(wy * WORLD_SIZE + wx);
    const input = window.prompt(
      existing ? `街の名前 (空にすると消す)` : `新しい街の名前 (最大 ${MAX_TOWN_NAME} 文字)`,
      existing?.name ?? '',
    );
    if (input === null) return; // キャンセル
    const name = input.trim();
    const rest = worldTownOverrides().filter((t) => wrap(t.x) !== wx || wrap(t.y) !== wy);
    try {
      if (name === '') {
        setTownOverrides([...rest, { x: wx, y: wy }]); // 名前なし = 消す
        setNote(`(${wx}, ${wy}) の街を消した`);
      } else {
        setTownOverrides([...rest, { x: wx, y: wy, name }]);
        tiles[wy * WORLD_SIZE + wx] = BASE_PALETTE.indexOf('town');
        setNote(`(${wx}, ${wy}) に「${name}」を置いた。店の品揃えは座標から決まる`);
      }
      setDirty(true);
      setTick((n) => n + 1);
      setTownTick((n) => n + 1);
    } catch (e) {
      setNote(String(e));
    }
  }, [origin]);

  /**
   * **保存せずに、自分のブラウザでだけ試す。**
   *
   * 編集はコピーの上で行うので、置いただけでは `/world` に出ない。これを押すと
   * 読み込み済みの地図と差し替わり、**このタブでワールドを歩いて確かめられる**。
   * 他の人には見えないし、リロードすると元に戻る (保存していないため)。
   */
  /**
   * **画面座標からマスを引いて置く。**
   *
   * `onMouseEnter` に頼ると**タッチでは連続配置できない** — 指を滑らせても
   * enter/leave が飛ばないため、1 マスずつタップするしかなくなる (実機で発生)。
   * ポインタ座標を SVG の座標系に落として自分で解決する。
   */
  const paintAtPointer = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const cx = Math.floor(((clientX - r.left) / r.width) * COLS);
    const cy = Math.floor(((clientY - r.top) / r.height) * ROWS);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return;
    place(cx, cy);
  }, [place]);

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
    void townTick;
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
  }, [origin, tick, townTick, ready]);

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
    // **文字選択を止める。** 地図をドラッグすると近くの文字が選択され、iOS では
    // 選択が解除できずボタンも押せなくなる (実機で発生)。
    <div style={{ padding: '0.8em', maxWidth: '100%', userSelect: 'none', WebkitUserSelect: 'none' }}>
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
        サーバーが拾うまで最大 5 分かかる。<br />
        <strong>街をおく</strong> にすると、押したマスに街を作る (名前を聞く)。
        <strong>地形の「街」パーツを置いただけでは街にならない</strong> —
        名前も店も宿も無い、通れるだけのマスになる。
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
            <label title="マスを押すと名前を聞く。空にすると街を消す">
              <input type="checkbox" checked={townMode} onChange={(e) => setTownMode(e.target.checked)} /> 街をおく
            </label>
            <span style={{ color: 'var(--color-muted)', fontFamily: 'ui-monospace, monospace' }}>
              ({origin.x}, {origin.y}) 〜 ({wrap(origin.x + COLS - 1)}, {wrap(origin.y + ROWS - 1)})
            </span>
          </div>

          {/* 地図本体 */}
          {/* **操作は地図の上に置く。** 下に並べると、置くたびに画面をスクロールして
              戻る羽目になる (実機で「鬼めんどい」との指摘)。 */}
          <div style={{ position: 'relative', width: 'fit-content', maxWidth: '100%' }}>
          <div style={{ overflow: 'auto', maxWidth: '100%', border: '2px solid var(--color-border)', width: 'fit-content' }}>
            <svg
              ref={svgRef}
              width={W}
              height={H}
              viewBox={`0 0 ${COLS * 32} ${ROWS * 32}`}
              onPointerDown={(e) => {
                e.preventDefault(); // 文字選択とスクロールを始めさせない
                if (townMode) return; // 街は 1 マスずつ (名前を聞くので連続配置しない)
                painting.current = true;
                (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
                paintAtPointer(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => { if (painting.current) paintAtPointer(e.clientX, e.clientY); }}
              onPointerUp={(e) => {
                painting.current = false;
                try { (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); } catch { /* 既に外れている */ }
              }}
              onPointerCancel={() => { painting.current = false; }}
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
                  onClick={() => { if (townMode) editTown(cx, cy); }}
                />
              ))}
            </svg>
          </div>

          {/* 十字キー (地図の左下に重ねる)。半画面ずつ動く。 */}
          <div
            style={{
              position: 'absolute', left: 6, bottom: 6,
              display: 'grid', gridTemplateColumns: 'repeat(3, 34px)', gridTemplateRows: 'repeat(3, 34px)',
              gap: 2, opacity: 0.9,
            }}
          >
            <span />
            <PanBtn label="↑" onClick={() => pan(0, -Math.floor(ROWS / 2))} />
            <span />
            <PanBtn label="←" onClick={() => pan(-Math.floor(COLS / 2), 0)} />
            <span />
            <PanBtn label="→" onClick={() => pan(Math.floor(COLS / 2), 0)} />
            <span />
            <PanBtn label="↓" onClick={() => pan(0, Math.floor(ROWS / 2))} />
            <span />
          </div>

          {/* 反映・保存も地図の上に重ねる (下までスクロールしないで済むように) */}
          <div style={{ position: 'absolute', right: 6, bottom: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            {dirty && (
              <span style={{ fontSize: '0.7em', color: '#fff', background: 'rgba(180,40,40,0.85)', padding: '0.1em 0.4em', borderRadius: 3 }}>
                未保存
              </span>
            )}
            <button type="button" onClick={preview} style={{ fontSize: '0.75em', padding: '0.25em 0.6em', opacity: 0.92 }}>
              ためす
            </button>
            <button type="button" onClick={() => void save()} disabled={!session.agent} style={{ fontSize: '0.75em', padding: '0.25em 0.6em', opacity: 0.92 }}>
              みんなに反映
            </button>
          </div>
          </div>

          {/* **全体マップ。** 1024 タイルを 1 画素ずつ縮めて出し、押した場所へ飛ぶ。
              ボタン移動だけだと世界の端から端まで数十回押すことになる。 */}
          <WorldMinimap
            tiles={draftRef.current}
            origin={origin}
            townTick={townTick}
            onJump={(x, y) => setOrigin({ x: wrap(x - Math.floor(COLS / 2)), y: wrap(y - Math.floor(ROWS / 2)) })}
          />

          {/* 移動 */}
          <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', marginTop: '0.5em', fontSize: '0.85em' }}>
            {/* 1 マス微調整 (半画面ぶんは地図に重ねた十字キー)。 */}
            {([
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

/** 地図に重ねる十字キー 1 つ。押しやすさ優先で大きめ・半透明。 */
function PanBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={onClick}
      style={{
        width: 34, height: 34, padding: 0, fontSize: '1em', lineHeight: 1,
        background: 'rgba(20,22,30,0.85)', color: '#fff',
        border: '1px solid rgba(255,255,255,0.5)', borderRadius: 4,
      }}
    >
      {label}
    </button>
  );
}

/** 全体マップ (1024×1024 を縮小)。押した場所へビューを飛ばす。 */
function WorldMinimap({
  tiles,
  origin,
  townTick,
  onJump,
}: {
  tiles: Uint8Array | null;
  origin: { x: number; y: number };
  /** 街を編集したら描き直すためのカウンタ (街は別データなので tiles の変化では拾えない)。 */
  townTick: number;
  onJump: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  /** 表示サイズ (px)。1024 を SAMPLE 間隔で間引いて描く。 */
  const PX = 256;
  const SAMPLE = WORLD_SIZE / PX; // 4

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !tiles) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(PX, PX);
    const buf = new Uint32Array(img.data.buffer);
    for (let y = 0; y < PX; y++) {
      const row = y * SAMPLE * WORLD_SIZE;
      for (let x = 0; x < PX; x++) {
        const hex = editorColorAt(tiles[row + x * SAMPLE]!);
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        buf[y * PX + x] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
    }
    ctx.putImageData(img, 0, 0);

    // **街を出す。** 全体マップで場所が分からないと、どこへ飛べばいいか決められない。
    // 1024 を 256 に縮めているので、街 1 マスは 0.25px = そのままでは見えない。
    // 縮尺に関係なく見える大きさの点で描く (縁取りして地形の上でも沈まないようにする)。
    for (const t of worldOverlay().towns) {
      const x = t.x / SAMPLE;
      const y = t.y / SAMPLE;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f5d442';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#3a2c00';
      ctx.stroke();
    }
    // spawn (はじまりの街) だけ形を変える
    const sp = worldOverlay().spawn;
    ctx.beginPath();
    ctx.arc(sp.x / SAMPLE, sp.y / SAMPLE, 4.5, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // 今どこを見ているか
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(origin.x / SAMPLE, origin.y / SAMPLE, COLS / SAMPLE, ROWS / SAMPLE);
  }, [tiles, origin, SAMPLE, townTick]);

  return (
    <div style={{ marginTop: '0.6em' }}>
      <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginBottom: '0.2em' }}>
        全体マップ (押すとその場所へ飛ぶ)。<span style={{ color: '#f5d442' }}>●</span> が街、
        白い丸が はじまりの街、白い枠が今見ている範囲。
      </div>
      <canvas
        ref={ref}
        width={PX}
        height={PX}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onJump(
            Math.round(((e.clientX - r.left) / r.width) * WORLD_SIZE),
            Math.round(((e.clientY - r.top) / r.height) * WORLD_SIZE),
          );
        }}
        style={{
          width: PX, height: PX, imageRendering: 'pixelated',
          border: '2px solid var(--color-border)', cursor: 'crosshair', touchAction: 'none',
        }}
      />
    </div>
  );
}
