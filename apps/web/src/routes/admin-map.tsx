import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BASE_PALETTE,
  WORLD_SIZE,
  MAX_TOWN_NAME,
  editorColorAt,
  encodeWorldMap,
  setTownOverrides,
  setWorldParts,
  worldParts,
  worldTownOverrides,
  setWorldMap,
  worldMapTiles,
  worldOverlay,
  wrap,
  type Terrain,
  PART_PRESETS,
  presetArt,
  setTileArt,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { loadAuthoredWorld, saveTileArts, saveWorldMap } from '@/lib/world-authoring';
import { TERRAIN_TILES, fallbackTile, pixelPart } from '@/components/world-tiles';
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
/**
 * 地図を出す枠のおおよその一辺 (px)。**タイル数はここから割り出す**ので、
 * どの倍率でも**正方形**になる (24×16 固定だと 16px で横長に潰れていた)。
 */
const BOX = 384;
/** 表示するタイル数 (縦横とも同じ = 正方形)。倍率が小さいほど広く見える。 */
function viewTiles(tilePx: number): number {
  return Math.max(8, Math.round(BOX / tilePx));
}

/** パーツの絵 (ワールド画面と同じ)。index ごとの絵 → 地形の絵 → SVG → 代表色 の順に倒す。 */
function partOf(index: number, terrain: string) {
  return pixelPart(index, terrain)
    ?? TERRAIN_TILES[terrain as Terrain]
    ?? fallbackTile(terrain);
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
  const [parts, setParts] = useState(() => [...worldParts()]);
  const painting = useRef(false);
  /** プリセット追加の保存が往復中 (連続追加の競合防止)。 */
  const presetBusyRef = useRef(false);
  /** 表示タイル数 (正方形)。倍率で変わる。 */
  const view = viewTiles(tilePx);
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
        setParts([...worldParts()]); // 保存済みの増設ぶんを拾う
        // spawn 付近から始める (いきなり (0,0) の海を見せない)
        const sp = worldOverlay().spawn;
        const v = viewTiles(24);
        setOrigin({ x: wrap(sp.x - Math.floor(v / 2)), y: wrap(sp.y - Math.floor(v / 2)) });
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
   * **画面座標からマスを引いて置く。**
   *
   * `onMouseEnter` に頼るとタッチで連続配置できない (指を滑らせても enter/leave が
   * 飛ばないため、1 マスずつタップするしかなくなる)。座標から自分で解決する。
   */
  const paintAtPointer = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const cx = Math.floor(((clientX - r.left) / r.width) * view);
    const cy = Math.floor(((clientY - r.top) / r.height) * view);
    if (cx < 0 || cy < 0 || cx >= view || cy >= view) return;
    place(cx, cy);
  }, [place, view]);

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
    const out: Array<{ cx: number; cy: number; idx: number; t: Terrain; town: string | null }> = [];
    for (let cy = 0; cy < view; cy++) {
      for (let cx = 0; cx < view; cx++) {
        const wx = wrap(origin.x + cx);
        const wy = wrap(origin.y + cy);
        const idx = tiles[wy * WORLD_SIZE + wx]!;
        const t = (BASE_PALETTE[idx] ?? 'plains') as Terrain;
        const town = worldOverlay().townMap.get(wy * WORLD_SIZE + wx)?.name ?? null;
        out.push({ cx, cy, idx, t, town });
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

  const W = view * tilePx;
  const H = view * tilePx;
  const pan = (dx: number, dy: number) =>
    setOrigin((o) => ({ x: wrap(o.x + dx), y: wrap(o.y + dy) }));

  return (
    // **文字選択を止める。** 地図をドラッグすると近くの文字が選択され、iOS では
    // 選択が解除できずボタンも押せなくなる (実機で発生)。
    <div style={{ padding: '0.8em', maxWidth: '100%', userSelect: 'none', WebkitUserSelect: 'none' }}>
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', marginBottom: '0.4em' }}>
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
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

      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.3em' }}>{note}</p>}

      {tab === 'art' ? (
        <TileArtEditor parts={parts} />
      ) : !ready ? (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>地図を読み込んでいる…</p>
      ) : (
        <>
          {/* パーツ選び。色ではなく**実際の絵**を並べる。 */}
          <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.3em' }}>
            {parts.map((pt, i) => (
              <button
                key={`${i}-${pt.name}`}
                type="button"
                onClick={() => setBrush(i)}
                title={`${pt.name} (${pt.terrain})`}
                style={{
                  padding: 2, lineHeight: 0, background: 'transparent',
                  border: brush === i ? '3px solid var(--color-accent)' : '1px solid var(--color-border)',
                }}
              >
                <svg width={36} height={36} viewBox="0 0 32 32">{partOf(i, pt.terrain)}</svg>
                <div style={{ fontSize: '0.6em', color: 'var(--color-muted)', lineHeight: 1.4 }}>{pt.name}</div>
              </button>
            ))}
            {/* **パーツを増やす。** 「縦の橋」のように通行判定は既存と同じで絵だけ違うものを足す。 */}
            <button
              type="button"
              onClick={() => {
                // 定番 (城/ダンジョン入口 #424) は絵つきのプリセットで足せる。
                const pick = window.prompt(
                  `追加するパーツ:\n${PART_PRESETS.map((p, i) => `${i + 1} = ${p.name} (絵つき)`).join('\n')}\n空欄 = 白紙 (名前を決めて自分で描く)`,
                  '',
                )?.trim();
                if (pick === undefined) return;
                const preset = /^\d+$/.test(pick) ? PART_PRESETS[Number(pick) - 1] : undefined;
                if (pick !== '' && !preset) { setNote('その番号のプリセットは無い'); return; }
                if (preset) {
                  // 直列化 — 保存応答前の連続追加は 2 本の putRecord の後勝ちで
                  // 新しい方の絵が保存から抜けうる (レビュー ★★)。
                  if (presetBusyRef.current) return;
                  presetBusyRef.current = true;
                  void (async () => {
                    try {
                      const next = [...parts, { terrain: preset.terrain, name: preset.name, walkable: preset.walkable }];
                      setWorldParts(next);
                      setParts(next);
                      setBrush(next.length - 1);
                      // 同梱の絵も登録して**即保存** — パーツと絵が別レコードなので、
                      // ここで揃えて書かないと「一覧にはあるのに絵が無い」で再現しにくい。
                      // dirty (タイル draft の未保存バッジ) には触らない — ここで消すと
                      // 塗りかけの編集が保存済みに見えて消える (レビュー ★★★)。
                      setTileArt(`part:${next.length - 1}`, presetArt(preset));
                      if (session.agent) {
                        await saveTileArts(session.agent);
                        setNote(`「${preset.name}」を絵つきで足して保存した。絵は「パーツの絵」タブで描き直せる`);
                      } else {
                        setNote(`「${preset.name}」を足したが、未ログインなので**保存されていない**`);
                      }
                    } catch (e) {
                      setNote(`プリセットを保存できなかった: ${String(e)} (リロードすると消える)`);
                    } finally {
                      presetBusyRef.current = false;
                    }
                  })();
                  return;
                }
                const name = window.prompt('パーツの名前 (例: たての橋)')?.trim();
                if (!name) return;
                const terrain = window.prompt(
                  `通行判定をどの地形と同じにする？\n${BASE_PALETTE.join(' / ')}`,
                  'bridge',
                )?.trim();
                if (!terrain || !(BASE_PALETTE as readonly string[]).includes(terrain)) {
                  setNote('元にする地形が不正');
                  return;
                }
                // **通行可否はパーツ自身が持つ。** 地形任せだと「見た目は橋だが通れない飾り」
                // 「見た目は山だが抜けられる隘路」が作れない。
                const walkable = window.confirm(`「${name}」は歩いて通れる？\n(OK = 通れる / キャンセル = 通れない)`);
                try {
                  const next = [...parts, { terrain, name, walkable }];
                  setWorldParts(next);
                  setParts(next);
                  setBrush(next.length - 1);
                  setDirty(true);
                  setNote(`「${name}」を足した (${walkable ? '通れる' : '通れない'})。絵は「パーツの絵」タブで描く`);
                } catch (e) {
                  setNote(String(e));
                }
              }}
              style={{ padding: '0.3em 0.5em', fontSize: '0.8em', alignSelf: 'center' }}
            >
              ＋パーツ
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.6em', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.3em', fontSize: '0.8em' }}>
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
              {origin.x},{origin.y}
            </span>
          </div>

          {/* 地図本体 */}
          {/* **操作は地図の上に置く。** 下に並べると、置くたびに画面をスクロールして
              戻る羽目になる (実機で「鬼めんどい」との指摘)。 */}
          <div style={{ position: 'relative', width: 'fit-content', maxWidth: '100%' }}>
          <div style={{ overflow: 'auto', maxWidth: '100%', border: '2px solid var(--color-border)', width: 'fit-content' }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${view * 32} ${view * 32}`}
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
              // 固定 px だと狭い画面で画面外へ出る。幅に追随させ正方形を保つ
              // (置く座標はビューポート比から引くので、拡縮してもマスがずれない)。
              style={{ display: 'block', width: '100%', maxWidth: W, aspectRatio: '1 / 1', height: 'auto', cursor: 'crosshair', touchAction: 'none' }}
            >
              {/* 同じパーツは defs に 1 回だけ定義して use で参照 (#605)。全地形がドット絵に
                  なったので、マスごとの展開だと 16px 表示 (24×24 マス) で数万 rect になる。 */}
              <defs>
                {[...new Map(cells.map((c) => [`ed-${c.idx}-${c.t}`, c])).values()].map((c) => (
                  <g id={`ed-${c.idx}-${c.t}`} key={`ed-${c.idx}-${c.t}`}>{partOf(c.idx, c.t)}</g>
                ))}
              </defs>
              {cells.map(({ cx, cy, t, idx }) => (
                <use key={`${cx}-${cy}`} href={`#ed-${idx}-${t}`} x={cx * 32} y={cy * 32} />
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
                  {Array.from({ length: view + 1 }, (_, i) => (
                    <line
                      key={`v${i}`} x1={i * 32} y1={0} x2={i * 32} y2={view * 32}
                      stroke="#000" strokeOpacity={(origin.x + i) % 8 === 0 ? 0.55 : 0.22} strokeWidth={1}
                    />
                  ))}
                  {Array.from({ length: view + 1 }, (_, i) => (
                    <line
                      key={`h${i}`} x1={0} y1={i * 32} x2={view * 32} y2={i * 32}
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
            <PanBtn label="↑" onClick={() => pan(0, -Math.floor(view / 2))} />
            <span />
            <PanBtn label="←" onClick={() => pan(-Math.floor(view / 2), 0)} />
            <span />
            <PanBtn label="→" onClick={() => pan(Math.floor(view / 2), 0)} />
            <span />
            <PanBtn label="↓" onClick={() => pan(0, Math.floor(view / 2))} />
            <span />
          </div>

          {/* 反映・保存も地図の上に重ねる (下までスクロールしないで済むように) */}
          <div style={{ position: 'absolute', right: 6, bottom: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            {dirty && (
              <span style={{ fontSize: '0.7em', color: '#fff', background: 'rgba(180,40,40,0.85)', padding: '0.1em 0.4em', borderRadius: 3 }}>
                未保存
              </span>
            )}
            <button type="button" onClick={() => void save()} disabled={!session.agent} style={{ fontSize: '0.8em', padding: '0.3em 0.7em', opacity: 0.92 }}>
              保存
            </button>
          </div>
          </div>

          {/* **全体マップ。** 1024 タイルを 1 画素ずつ縮めて出し、押した場所へ飛ぶ。
              ボタン移動だけだと世界の端から端まで数十回押すことになる。 */}
          <WorldMinimap
            tiles={draftRef.current}
            origin={origin}
            view={view}
            townTick={townTick}
            onJump={(x, y) => setOrigin({ x: wrap(x - Math.floor(view / 2)), y: wrap(y - Math.floor(view / 2)) })}
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
                setOrigin({ x: wrap(sp.x - Math.floor(view / 2)), y: wrap(sp.y - Math.floor(view / 2)) });
              }}
              style={{ padding: '0.2em 0.6em' }}
            >
              はじまりの街へ
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.4em', marginTop: '0.6em', flexWrap: 'wrap', alignItems: 'center' }}>
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
  view,
  townTick,
  onJump,
}: {
  tiles: Uint8Array | null;
  origin: { x: number; y: number };
  /** いま見ているタイル数 (白枠の大きさ)。 */
  view: number;
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
    ctx.strokeRect(origin.x / SAMPLE, origin.y / SAMPLE, view / SAMPLE, view / SAMPLE);
  }, [tiles, origin, SAMPLE, townTick]);

  return (
    <div style={{ marginTop: '0.6em' }}>

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
