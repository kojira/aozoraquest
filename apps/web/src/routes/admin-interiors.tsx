import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BASE_PALETTE,
  InteriorError,
  MAX_INTERIOR_SIZE,
  WORLD_MAP_ID,
  interiorPartAt,
  interiorWalkableAt,
  worldParts,
  type Gate,
  type InteriorMap,
  type Terrain,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getPrimaryAdminDid, isAdminDid } from '@/lib/runtime-config';
import { loadInteriorsRecord, saveInteriors } from '@/lib/world-authoring';
import { TERRAIN_TILES, fallbackTile, pixelPart } from '@/components/world-tiles';

/**
 * **内部マップエディタ** (#424)。街の中・城・ダンジョンを描き、フィールドと繋ぐ。
 *
 * フィールドのマップエディタ (#421) と同じ「パーツを置く」方式。違いは:
 * - **端で折り返さない** (外へ出るのはゲートからだけ) ので、全体が 1 画面に収まる
 * - **ゲート** (出入口) を張る画面がある。ゲートは一方通行なので、往復は 2 本要る
 */

/** 新しい内部マップの既定の広さ。 */
const DEFAULT_SIZE = 16;
const BOX = 448;

function partOf(index: number, terrain: string) {
  return pixelPart(index, terrain) ?? TERRAIN_TILES[terrain as Terrain] ?? fallbackTile(terrain);
}

export function AdminInteriors() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [maps, setMaps] = useState<InteriorMap[]>([]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [brush, setBrush] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'failed'>('loading');
  /** ゲートを張る途中 (from を選んだ状態)。 */
  const [linking, setLinking] = useState<{ mapId: string; x: number; y: number } | null>(null);
  const painting = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const parts = useMemo(() => [...worldParts()], []);

  // 保存済みを読めなければ保存させない (コード値/空で上書きすると全部消える)。
  useEffect(() => {
    let cancelled = false;
    const agent = session.agent;
    const adminDid = getPrimaryAdminDid();
    if (!agent || !adminDid) { setLoadState('failed'); return; }
    void loadInteriorsRecord(agent, adminDid)
      .then((r) => {
        if (cancelled) return;
        setMaps(r.maps.map((m) => ({ ...m, tiles: new Uint8Array(m.tiles) })));
        setGates(r.gates.map((g) => ({ from: { ...g.from }, to: { ...g.to } })));
        setLoadState('ok');
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('[admin] interiors load failed', e);
        setLoadState('failed');
        setNote('保存済みの内部マップを読み込めなかった。上書きで消える恐れがあるので保存できない');
      });
    return () => { cancelled = true; };
  }, [session.agent]);

  const current = useMemo(() => maps.find((m) => m.id === sel) ?? null, [maps, sel]);

  const addMap = useCallback(() => {
    let i = maps.length + 1;
    while (maps.some((m) => m.id === `in-${i}`)) i++;
    // 既定は「床で埋めて外周を壁」— 白紙 (全部 index 0) だと外に歩いて出られてしまう。
    const size = DEFAULT_SIZE;
    const floor = Math.max(0, BASE_PALETTE.indexOf('plains'));
    const wall = Math.max(0, BASE_PALETTE.indexOf('mountain'));
    const tiles = new Uint8Array(size * size).fill(floor);
    for (let k = 0; k < size; k++) {
      tiles[k] = wall;
      tiles[(size - 1) * size + k] = wall;
      tiles[k * size] = wall;
      tiles[k * size + size - 1] = wall;
    }
    const m: InteriorMap = { id: `in-${i}`, name: 'あたらしい内部マップ', size, tiles };
    setMaps((xs) => [...xs, m]);
    setSel(m.id);
    setDirty(true);
  }, [maps]);

  const paintAt = useCallback((cx: number, cy: number) => {
    if (!current) return;
    if (cx < 0 || cy < 0 || cx >= current.size || cy >= current.size) return;
    setMaps((xs) => xs.map((m) => {
      if (m.id !== current.id) return m;
      const tiles = new Uint8Array(m.tiles);
      tiles[cy * m.size + cx] = brush;
      return { ...m, tiles };
    }));
    setDirty(true);
  }, [current, brush]);

  const pointerPaint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg || !current) return;
    const r = svg.getBoundingClientRect();
    const cx = Math.floor(((clientX - r.left) / r.width) * current.size);
    const cy = Math.floor(((clientY - r.top) / r.height) * current.size);
    if (linking !== null) return; // ゲート張り中は塗らない
    paintAt(cx, cy);
  }, [current, paintAt, linking]);

  const save = useCallback(async () => {
    if (!session.agent) return;
    try {
      await saveInteriors(session.agent, maps, gates);
      setDirty(false);
      setNote(`${maps.length} マップ / ${gates.length} ゲートを保存した。サーバーは最大 5 分で拾う`);
    } catch (e) {
      setNote(e instanceof InteriorError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
    }
  }, [session.agent, maps, gates]);

  if (!admin) {
    return (
      <div style={{ padding: '1em' }}>
        <p>この画面は管理者だけが使えます。</p>
        <Link to="/admin">管理ダッシュボードへ</Link>
      </div>
    );
  }

  const tile = current ? BOX / current.size : 0;
  const gatesHere = current ? gates.filter((g) => g.from.mapId === current.id) : [];

  return (
    <div className="admin-page" style={{ padding: '0.8em' }}>
      <div className="admin-head">
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>内部マップ</strong>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{maps.length} マップ / {gates.length} ゲート</span>
        <button type="button" onClick={addMap} style={{ fontSize: '0.85em' }}>＋マップ</button>
        <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty || loadState !== 'ok'} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>
          保存
        </button>
      </div>

      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}

      <div className="admin-cols">
        <div style={{ maxHeight: '75vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {maps.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSel(m.id)}
              style={{
                display: 'flex', gap: '0.3em', width: '100%', padding: '0.2em 0.4em', fontSize: '0.85em', textAlign: 'left',
                border: sel === m.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', background: 'transparent',
              }}
            >
              <span style={{ flex: 1 }}>{m.name}</span>
              <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{m.size}²</span>
            </button>
          ))}
          {maps.length === 0 && <span style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>まだ無い。「＋マップ」で作る</span>}
        </div>

        {current ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4em' }}>
            <div style={{ display: 'flex', gap: '0.4em', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8em' }}>
              <input
                value={current.name}
                onChange={(e) => { setMaps((xs) => xs.map((m) => (m.id === current.id ? { ...m, name: e.target.value } : m))); setDirty(true); }}
                style={{ width: '12em' }}
              />
              <code style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{current.id}</code>
              <label>
                おおきさ{' '}
                <input
                  type="number" min={4} max={MAX_INTERIOR_SIZE} value={current.size}
                  onChange={(e) => {
                    const size = Math.max(4, Math.min(MAX_INTERIOR_SIZE, Number(e.target.value) || 4));
                    setMaps((xs) => xs.map((m) => {
                      if (m.id !== current.id) return m;
                      // 広げ縮めても既存の絵を保つ (作り直させない)。増えた分は 0 (床)。
                      const tiles = new Uint8Array(size * size);
                      for (let y = 0; y < Math.min(size, m.size); y++) {
                        for (let x = 0; x < Math.min(size, m.size); x++) tiles[y * size + x] = m.tiles[y * m.size + x]!;
                      }
                      return { ...m, size, tiles };
                    }));
                    setDirty(true);
                  }}
                  style={{ width: '4.5em' }}
                />
              </label>
              <label>
                危険度{' '}
                <select
                  value={current.encounterTier ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMaps((xs) => xs.map((m) => {
                      if (m.id !== current.id) return m;
                      if (v === '') { const { encounterTier: _t, ...rest } = m; return rest as InteriorMap; }
                      return { ...m, encounterTier: Number(v) };
                    }));
                    setDirty(true);
                  }}
                >
                  <option value="">敵なし</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((t) => <option key={t} value={t}>tier {t}</option>)}
                </select>
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (!window.confirm(`「${current.name}」を消す？\nこのマップへのゲートも一緒に消える`)) return;
                  setMaps((xs) => xs.filter((m) => m.id !== current.id));
                  // 参照が残ると保存時に検証で落ちる (行き先の無いゲート) ので一緒に掃除する。
                  setGates((gs) => gs.filter((g) => g.from.mapId !== current.id && g.to.mapId !== current.id));
                  setSel(null);
                  setDirty(true);
                }}
                style={{ marginLeft: 'auto', fontSize: '0.8em' }}
              >
                削除
              </button>
            </div>

            {/* パーツのパレット (フィールドと共用) */}
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
              {parts.map((pt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setBrush(i)}
                  title={pt.name}
                  style={{ padding: 0, lineHeight: 0, border: brush === i ? '3px solid var(--color-accent)' : '1px solid var(--color-border)' }}
                >
                  <svg width={32} height={32} viewBox="0 0 32 32">{partOf(i, pt.terrain)}</svg>
                </button>
              ))}
            </div>

            <div style={{ fontSize: '0.8em', color: linking ? 'var(--color-accent)' : 'var(--color-muted)' }}>
              {linking
                ? `ゲートの出口を選ぶ: ${linking.mapId === WORLD_MAP_ID ? 'フィールド' : linking.mapId} (${linking.x}, ${linking.y}) → ここをクリック`
                : 'クリックで配置 / ドラッグで連続。Shift + クリックでゲートの入口にする'}
            </div>

            <svg
              ref={svgRef}
              viewBox={`0 0 ${current.size * 32} ${current.size * 32}`}
              onPointerDown={(e) => {
                e.preventDefault();
                const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const cx = Math.floor(((e.clientX - r.left) / r.width) * current.size);
                const cy = Math.floor(((e.clientY - r.top) / r.height) * current.size);
                if (linking && !e.shiftKey) { setLinking(null); setNote('ゲートの行き先選びをやめた'); return; }
                if (e.shiftKey) {
                  // Shift = ゲート。1 回目で入口、2 回目で出口 (一方通行 1 本ぶん)。
                  if (!linking) { setLinking({ mapId: current.id, x: cx, y: cy }); return; }
                  setGates((gs) => [...gs.filter((g) => !(g.from.mapId === linking.mapId && g.from.x === linking.x && g.from.y === linking.y)),
                    { from: linking, to: { mapId: current.id, x: cx, y: cy } }]);
                  setLinking(null);
                  setDirty(true);
                  return;
                }
                painting.current = true;
                (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
                paintAt(cx, cy);
              }}
              onPointerMove={(e) => { if (painting.current) pointerPaint(e.clientX, e.clientY); }}
              onPointerUp={(e) => {
                painting.current = false;
                try { (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); } catch { /* 既に外れている */ }
              }}
              onPointerCancel={() => { painting.current = false; }}
              // 固定 px だと狭い画面で画面外へ出る。**幅に追随させ、正方形は
              // aspect-ratio で保つ** (座標はビューポート比から引くので拡縮しても合う)。
              style={{
                display: 'block', width: '100%', maxWidth: BOX, aspectRatio: '1 / 1', height: 'auto',
                cursor: linking ? 'crosshair' : 'pointer', touchAction: 'none', userSelect: 'none',
              }}
            >
              <defs>
                {[...new Set(Array.from(current.tiles))].map((idx) => (
                  <g id={`it-${idx}`} key={idx}>{partOf(idx, parts[idx]?.terrain ?? BASE_PALETTE[idx] ?? 'plains')}</g>
                ))}
              </defs>
              {Array.from({ length: current.size }).map((_, cy) =>
                Array.from({ length: current.size }).map((_, cx) => (
                  <use key={`${cx}-${cy}`} href={`#it-${interiorPartAt(current, cx, cy)}`} x={cx * 32} y={cy * 32} />
                )),
              )}
              {/* ゲートの印 (どのマスが出入口か分からないと張り直せない) */}
              {gatesHere.map((g) => (
                <g key={`${g.from.x}-${g.from.y}`} transform={`translate(${g.from.x * 32},${g.from.y * 32})`}>
                  <rect x={2} y={2} width={28} height={28} fill="none" stroke="#f5d442" strokeWidth={3} />
                  <title>{`→ ${g.to.mapId === WORLD_MAP_ID ? 'フィールド' : g.to.mapId} (${g.to.x}, ${g.to.y})`}</title>
                </g>
              ))}
            </svg>

            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>このマップのゲート</span>
              {gatesHere.length === 0 && <div style={{ color: 'var(--color-muted)' }}>まだ無い</div>}
              {gatesHere.map((g) => (
                <div key={`${g.from.x},${g.from.y}`} style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
                  <span>({g.from.x}, {g.from.y}) → {g.to.mapId === WORLD_MAP_ID ? 'フィールド' : maps.find((m) => m.id === g.to.mapId)?.name ?? g.to.mapId} ({g.to.x}, {g.to.y})</span>
                  <button
                    type="button"
                    onClick={() => { setGates((gs) => gs.filter((x) => x !== g)); setDirty(true); }}
                    style={{ fontSize: '0.8em' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* フィールド ⇄ このマップ のゲートは座標入力で張る (フィールドは広すぎて
                この画面に出せないため。マップエディタ側の座標表示を見て入れる) */}
            <WorldGateForm
              key={current.id}
              mapId={current.id}
              map={current}
              size={current.size}
              onAdd={(g) => { setGates((gs) => [...gs.filter((x) => !(x.from.mapId === g.from.mapId && x.from.x === g.from.x && x.from.y === g.from.y)), g]); setDirty(true); }}
            />
          </div>
        ) : (
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>左の一覧から選ぶか「＋マップ」。</div>
        )}
      </div>
    </div>
  );
}

/** フィールド側の入口 (x, y) → この内部マップ の 1 本と、その戻り 1 本を張る。 */
function WorldGateForm({ mapId, map, size, onAdd }: { mapId: string; map: InteriorMap; size: number; onAdd: (g: Gate) => void }) {
  const [wx, setWx] = useState(0);
  const [wy, setWy] = useState(0);
  const [ix, setIx] = useState(Math.floor(size / 2));
  // 出口は下から 3 マス目。**戻りゲートを出口の 1 マス下に張る**ので、既定 size-2 だと
  // 戻りが外周の壁に乗って踏めなくなる (= 入ったら出られない罠。レビュー ★★★)。
  const [iy, setIy] = useState(Math.max(1, size - 3));
  // 戻りゲートが壁の上だと**踏めない = 入ったら出られない**ので、張る前に気づかせる。
  const backBlocked = !interiorWalkableAt(map, ix, iy + 1);
  const exitBlocked = !interiorWalkableAt(map, ix, iy);
  return (
    <div style={{ fontSize: '0.8em', borderTop: '1px solid var(--color-border)', paddingTop: '0.4em' }}>
      <span style={{ color: 'var(--color-muted)' }}>フィールドと繋ぐ (マップエディタの座標表示と同じ)</span>
      <div style={{ display: 'flex', gap: '0.3em', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.2em' }}>
        フィールド x<input type="number" value={wx} onChange={(e) => setWx(Number(e.target.value))} style={{ width: '5.5em' }} />
        y<input type="number" value={wy} onChange={(e) => setWy(Number(e.target.value))} style={{ width: '5.5em' }} />
        → 出口 x<input type="number" value={ix} onChange={(e) => setIx(Number(e.target.value))} style={{ width: '4em' }} />
        y<input type="number" value={iy} onChange={(e) => setIy(Number(e.target.value))} style={{ width: '4em' }} />
        <button
          type="button"
          disabled={backBlocked || exitBlocked}
          onClick={() => {
            // **往復 2 本まとめて張る。** 入る道だけ作ると出られなくなる。
            onAdd({ from: { mapId: WORLD_MAP_ID, x: wx, y: wy }, to: { mapId, x: ix, y: iy } });
            onAdd({ from: { mapId, x: ix, y: iy + 1 }, to: { mapId: WORLD_MAP_ID, x: wx, y: wy + 1 } });
          }}
        >
          往復を張る
        </button>
      </div>
      <span style={{ color: backBlocked || exitBlocked ? 'var(--color-danger)' : 'var(--color-muted)' }}>
        {exitBlocked
          ? `出口 (${ix}, ${iy}) が歩けないマス。床の上に置いて`
          : backBlocked
            ? `戻り口 (${ix}, ${iy + 1}) が歩けないマス。壁の上のゲートは踏めないので、出口を 1 つ上へ`
            : '戻りは出口の 1 マス下 → フィールドの入口の 1 マス下 に張る (入口を踏み直して即戻るのを防ぐ)'}
      </span>
    </div>
  );
}
