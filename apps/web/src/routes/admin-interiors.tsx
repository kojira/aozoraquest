import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BASE_PALETTE,
  InteriorError,
  DEFAULT_GATE_LOCKED_NOTICE,
  MAX_GATE_NOTICE,
  MAX_INTERIOR_SIZE,
  WORLD_MAP_ID,
  interiorPartAt,
  interiorWalkableAt,
  worldParts,
  worldOverlay,
  starterTownInterior,
  starterTownGates,
  STARTER_TOWN_ID,
  type Gate,
  type InteriorMap,
  type Terrain,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getPrimaryAdminDid, isAdminDid } from '@/lib/runtime-config';
import { loadAuthoredWorld, loadInteriorsRecord, saveInteriors } from '@/lib/world-authoring';
import { ItemReqInput } from '@/components/admin/item-req-input';
import { TERRAIN_TILES, fallbackTile, pixelPart, pixelTile } from '@/components/world-tiles';

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

/**
 * パーツの絵。**独自のパーツ表を持つ内部マップでは index で引かない** (#626) —
 * `part:<index>` はフィールドと番号空間を共有するので、内部の 3 番が
 * フィールドの 3 番 (池) の絵になってしまう。地形名だけで引く。
 */
function partOf(index: number, terrain: string, ownParts = false) {
  const art = ownParts ? pixelTile(terrain) : pixelPart(index, terrain);
  return art ?? TERRAIN_TILES[terrain as Terrain] ?? fallbackTile(terrain);
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
  const current = useMemo(() => maps.find((m) => m.id === sel) ?? null, [maps, sel]);
  /**
   * **そのマップのパーツ表**を使う (#626)。フィールドのパーツ表で描いていたため、
   * 村の「屋根」がフィールドの 3 番 (池) の絵で出て、家が青くなっていた。
   * 独自のパーツ表を持たないマップだけフィールドのものに倒す。
   */
  const parts = useMemo(() => current?.parts ?? [...worldParts()], [current]);

  // 保存済みを読めなければ保存させない (コード値/空で上書きすると全部消える)。
  useEffect(() => {
    let cancelled = false;
    const agent = session.agent;
    const adminDid = getPrimaryAdminDid();
    if (!agent || !adminDid) { setLoadState('failed'); return; }
    // **アイテムを先に読む** — 解錠アイテムの検証が ITEMS を引くので、この画面を
    // 直接開くと「アイテムが存在しない」で保存も読み込みも落ちる (レビュー ★★★)。
    void loadAuthoredWorld(agent)
      .then(() => loadInteriorsRecord(agent, adminDid))
      .then((r) => {
        if (cancelled) return;
        setMaps(r.maps.map((m) => ({ ...m, tiles: new Uint8Array(m.tiles) })));
        // **ゲートは丸ごと写す。** from/to だけ拾っていたため、開き直して保存すると
        // 施錠 (requireFlags/requireItems) とことばが全ゲートぶん消えていた
        // (レビュー ★★★)。増えたフィールドを書き漏らさないよう spread で複製する。
        setGates(r.gates.map((g) => ({ ...g, from: { ...g.from }, to: { ...g.to } })));
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
  // このマップ**から出る**ゲートと、**このマップへ入る**ゲートの両方を出す。
  // 入口を出していなかったので「ゲート: まだ無い」と表示され、繋がっているのに
  // 繋がっていないように見えた。
  const gatesHere = current ? gates.filter((g) => g.from.mapId === current.id) : [];
  const gatesIn = current ? gates.filter((g) => g.to.mapId === current.id) : [];

  return (
    <div className="admin-page" style={{ padding: '0.8em' }}>
      <div className="admin-head">
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>内部マップ</strong>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{maps.length} マップ / {gates.length} ゲート</span>
        <button type="button" onClick={addMap} style={{ fontSize: '0.85em' }}>＋マップ</button>
        <button
          type="button"
          onClick={() => {
            // **入れ直せるようにする。** 同梱の村を直したとき (パーツ・看板・端から出る等)
            // 「既にある」で断ると、消してから入れ直す手間が要る。上書きでよいか聞く。
            const existing = maps.some((m) => m.id === STARTER_TOWN_ID);
            if (existing && !window.confirm('「ふたばの村」を最新の同梱版で置き換える？\nこの村に加えた編集は消える')) return;
            const spawn = worldOverlay().spawn;
            const village = starterTownInterior(spawn);
            // 往復 2 本まとめて張る (入る道だけだと出られない)。フィールド側の入口は
            // 最初の街のマスそのもの。
            const gates = starterTownGates(spawn);
            setMaps((xs) => [...xs.filter((m) => m.id !== village.id), village]);
            setGates((gs) => [
              // 同じ入口の重複と、**この村から出る古いゲート**を落とす
              // (端から出る設計 #626 になったので戻りゲートは要らない)。
              // **村の外を指すようになった行き先も落とす** — 村を小さく作り直すと
              // (64→32) 旧座標を指すゲートが範囲外になり、検証で弾かれて
              // 「保存」そのものが通らなくなる (#644 レビュー ★★)。
              ...gs.filter((g) => g.from.mapId !== village.id
                && !(g.to.mapId === village.id
                  && (g.to.x < 0 || g.to.y < 0 || g.to.x >= village.size || g.to.y >= village.size))
                && !gates.some((n) => n.from.mapId === g.from.mapId && n.from.x === g.from.x && n.from.y === g.from.y)),
              ...gates,
            ]);
            setSel(village.id);
            setDirty(true);
            setNote(`「${village.name}」を${existing ? '入れ直した' : '入れた'}。保存するとフィールドの (${spawn.x}, ${spawn.y}) から入れる`);
          }}
          style={{ fontSize: '0.85em' }}
        >
          はじまりの村を入れる
        </button>
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
                  <svg width={32} height={32} viewBox="0 0 32 32">{partOf(i, pt.terrain, !!current?.parts)}</svg>
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
                  <g id={`it-${idx}`} key={idx}>{partOf(idx, parts[idx]?.terrain ?? BASE_PALETTE[idx] ?? 'plains', !!current?.parts)}</g>
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
              {gatesHere.length === 0 && <div style={{ color: 'var(--color-muted)' }}>このマップから出るゲートは無い (端まで歩けば出る)</div>}
              <div style={{ color: 'var(--color-muted)', marginTop: '0.3em' }}>ここへ入るゲート</div>
              {gatesIn.length === 0 && <div style={{ color: 'var(--color-danger)' }}>まだ無い — 下の「入口を作る」で繋ぐ</div>}
              {gatesIn.map((g) => (
                <div key={`in-${g.from.mapId}-${g.from.x},${g.from.y}`} style={{ display: 'flex', gap: '0.4em', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>
                    {g.from.mapId === WORLD_MAP_ID ? 'フィールド' : maps.find((m) => m.id === g.from.mapId)?.name ?? g.from.mapId}
                    {' '}({g.from.x}, {g.from.y}) → ({g.to.x}, {g.to.y})
                  </span>
                  <button type="button" onClick={() => { setGates((gs) => gs.filter((x) => x !== g)); setDirty(true); }} style={{ fontSize: '0.8em' }}>×</button>
                </div>
              ))}
              {gatesHere.map((g) => (
                <div key={`${g.from.x},${g.from.y}`} style={{ display: 'flex', gap: '0.4em', alignItems: 'center', flexWrap: 'wrap', margin: '0.15em 0' }}>
                  <span>({g.from.x}, {g.from.y}) → {g.to.mapId === WORLD_MAP_ID ? 'フィールド' : maps.find((m) => m.id === g.to.mapId)?.name ?? g.to.mapId} ({g.to.x}, {g.to.y})</span>
                  {/* 解禁フラグ (#426)。立つまで踏んでも通れない = エリア解放の手段 */}
                  <input
                    value={(g.requireFlags ?? []).join(' ')}
                    placeholder="解禁フラグ (空 = いつでも通れる)"
                    onChange={(e) => {
                      const flags = e.target.value.split(/\s+/).filter(Boolean);
                      setGates((gs) => gs.map((x) => {
                        if (x !== g) return x;
                        if (flags.length === 0) { const { requireFlags: _f, ...rest } = x; return rest as Gate; }
                        return { ...x, requireFlags: flags };
                      }));
                      setDirty(true);
                    }}
                    style={{ width: '14em', fontFamily: 'ui-monospace, monospace' }}
                  />
                  {/* 解禁アイテム (#426)。フラグの代わりに「かぎを持っていれば開く」 */}
                  <ItemReqInput
                    value={g.requireItems}
                    placeholder="解禁アイテム (空 = 不要)"
                    onChange={(requireItems) => {
                      setGates((gs) => gs.map((x) => {
                        if (x !== g) return x;
                        if (!requireItems) { const { requireItems: _r, ...rest } = x; return rest as Gate; }
                        return { ...x, requireItems };
                      }));
                      setDirty(true);
                    }}
                  />
                  {/* 通れないときのことば。場所ごとの理由を書ける (#426) */}
                  {((g.requireFlags?.length ?? 0) > 0 || (g.requireItems?.length ?? 0) > 0) && (
                    <input
                      value={g.lockedNotice ?? ''}
                      maxLength={MAX_GATE_NOTICE}
                      placeholder={DEFAULT_GATE_LOCKED_NOTICE}
                      onChange={(e) => {
                        const v = e.target.value;
                        setGates((gs) => gs.map((x) => {
                          if (x !== g) return x;
                          if (v.trim() === '') { const { lockedNotice: _n, ...rest } = x; return rest as Gate; }
                          return { ...x, lockedNotice: v };
                        }));
                        setDirty(true);
                      }}
                      style={{ width: '16em' }}
                    />
                  )}
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

/**
 * **フィールドのこのマスから、この内部マップへ入れるようにする**フォーム。
 *
 * 以前は「往復を張る」という名前で、入る道と戻る道の 2 本を同時に作っていた。
 * 端まで歩けば外に出る (#626) ようにしたので**戻り道はもう要らない**うえ、
 * 「往復」が何を指すのか分からない、とオーナーから指摘された。名前と中身を
 * 「入口を作る」に揃える。
 */
function WorldGateForm({ mapId, map, size, onAdd }: { mapId: string; map: InteriorMap; size: number; onAdd: (g: Gate) => void }) {
  const [wx, setWx] = useState(0);
  const [wy, setWy] = useState(0);
  const [ix, setIx] = useState(Math.floor(size / 2));
  const [iy, setIy] = useState(Math.max(1, size - 3));
  // **降り立つ場所が歩けないと詰む** (壁の中に立つ)。張る前に気づかせる。
  const landBlocked = !interiorWalkableAt(map, ix, iy);
  // 端から出られないマップは、別途 出口のゲートを張らないと出られなくなる。
  const noWayOut = !map.exitTo;
  return (
    <div style={{ fontSize: '0.8em', borderTop: '1px solid var(--color-border)', paddingTop: '0.4em' }}>
      <span style={{ color: 'var(--color-muted)' }}>
        フィールドから入れるようにする (座標はマップエディタの表示と同じ)
      </span>
      <div style={{ display: 'flex', gap: '0.3em', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.2em' }}>
        フィールドの x<input type="number" value={wx} onChange={(e) => setWx(Number(e.target.value))} style={{ width: '5.5em' }} />
        y<input type="number" value={wy} onChange={(e) => setWy(Number(e.target.value))} style={{ width: '5.5em' }} />
        に入ると、ここの x<input type="number" value={ix} onChange={(e) => setIx(Number(e.target.value))} style={{ width: '4em' }} />
        y<input type="number" value={iy} onChange={(e) => setIy(Number(e.target.value))} style={{ width: '4em' }} />
        に出る
        <button
          type="button"
          disabled={landBlocked}
          onClick={() => onAdd({ from: { mapId: WORLD_MAP_ID, x: wx, y: wy }, to: { mapId, x: ix, y: iy } })}
        >
          入口を作る
        </button>
      </div>
      <span style={{ color: landBlocked || noWayOut ? 'var(--color-danger)' : 'var(--color-muted)' }}>
        {landBlocked
          ? `降り立つ場所 (${ix}, ${iy}) が歩けないマス。床の上に置いて`
          : noWayOut
            ? 'このマップは端から出られない設定。別に出口のゲートを張らないと、入ったら出られなくなる'
            : '出るときは端まで歩けばフィールドに戻る (戻り用のゲートは要らない)'}
      </span>
    </div>
  );
}
