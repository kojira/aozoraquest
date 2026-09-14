import { useEffect, useMemo, useRef, useState } from 'react';
import { BASE_PALETTE, EDITOR_TERRAIN_COLORS, npcArtKey, WORLD_MAP_ID, WORLD_SIZE, wrap, type NpcDef, type Terrain } from '@aozoraquest/core';
import { npcMapId, placementCell, validateNpcPlacement, type NpcPlacementWorld } from '@/lib/npc-placement';
import { NpcSprite } from '../npc-sprite';
import { fallbackTile, renderArt, TERRAIN_TILES } from '../world-tiles';
import { paintTerrainOverview } from './world-minimap';
import { useMapTap } from './use-map-tap';
import './npc-placement-map.css';

type Point = { x: number; y: number };
export function NpcPlacementMap({ world, npc, draft, mapId, onPlace, disabled = false }: {
  disabled?: boolean; world: NpcPlacementWorld; npc: NpcDef; draft: readonly NpcDef[]; mapId: string; onPlace: (position: Pick<NpcDef, 'mapId' | 'x' | 'y'>) => void;
}) {
  const interior = world.interiors.find((m) => m.id === mapId);
  const field = mapId === WORLD_MAP_ID;
  const size = field ? WORLD_SIZE : interior?.size ?? 9;
  const initial = npcMapId(npc) === mapId ? npc : field ? world.spawn : { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  const [center, setCenter] = useState<Point>(initial);
  const [cursor, setCursor] = useState<Point>(initial);
  const [zoom, setZoom] = useState(9);
  const [width, setWidth] = useState(320);
  const [overview, setOverview] = useState(false);
  const [note, setNote] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  const view = Math.min(size, width / zoom < 24 ? 9 : zoom);
  const normalize = (p: Point): Point => field ? { x: wrap(p.x), y: wrap(p.y) } : { x: Math.max(0, Math.min(size - 1, p.x)), y: Math.max(0, Math.min(size - 1, p.y)) };
  const origin = {
    x: field ? wrap(center.x - Math.floor(view / 2)) : Math.max(0, Math.min(size - view, center.x - Math.floor(view / 2))),
    y: field ? wrap(center.y - Math.floor(view / 2)) : Math.max(0, Math.min(size - view, center.y - Math.floor(view / 2))),
  };
  const place = (p: Point) => {
    if (disabled) return;
    const result = validateNpcPlacement(world, { ...npc, mapId, ...p }, draft);
    setCursor(p);
    if (result.reason) setNote(result.reason);
    else if (result.position) { onPlace(result.position); setNote(`(${result.position.x}, ${result.position.y}) に配置しました。未保存です`); }
  };
  const gestureKey = `${npc.id}/${mapId}/${origin.x}/${origin.y}/${view}/${disabled}`;
  const tap = useMapTap(gestureKey, view, (x, y) => place(normalize({ x: origin.x + x, y: origin.y + y })), disabled);
  const occupants = useMemo(() => new Map(draft.filter((n) => npcMapId(n) === mapId).map((n) => [`${field ? wrap(n.x) : n.x},${field ? wrap(n.y) : n.y}`, n])), [draft, mapId, field]);
  const cells = [];
  for (let y = 0; y < view; y++) for (let x = 0; x < view; x++) {
    const p = normalize({ x: origin.x + x, y: origin.y + y });
    const c = placementCell(world, mapId, p.x, p.y);
    if (!c) continue;
    const occupant = occupants.get(`${p.x},${p.y}`);
    const selected = occupant?.id === npc.id;
    const label = c.facility === '宿屋' ? '宿' : c.facility === 'なんでも屋' ? '店' : c.facility ? '門' : c.town || c.terrain === 'town' ? '街' : c.spawn ? '始' : c.landing ? '着' : '';
    cells.push(<g key={`${x},${y}`} transform={`translate(${x * 32},${y * 32})`} data-cell={`${p.x},${p.y}`}>
      {renderArt(c.art) ?? TERRAIN_TILES[c.terrain as Terrain] ?? fallbackTile(c.terrain)}
      {!c.walkable && <path d="M3 3 L29 29 M29 3 L3 29" stroke="#201d28" strokeOpacity="0.4" strokeWidth="2" />}
      {label && <g><rect x="1" y="1" width="19" height="19" fill="#171923" opacity="0.85" /><text x="10" y="15" textAnchor="middle" fill="white" fontSize="14">{label}</text></g>}
      {occupant && <><NpcSprite npc={occupant} customArt={world.arts.get(npcArtKey(occupant.id)) ?? null} /><rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke={selected ? '#fff051' : '#ffffff'} strokeDasharray={selected ? undefined : '3 2'} strokeWidth="2" /><title>{occupant.name}{selected ? '（選択中）' : '（他のNPC）'}</title></>}
      {normalize(cursor).x === p.x && normalize(cursor).y === p.y && <rect x="4" y="4" width="24" height="24" fill="none" stroke="#002e65" strokeWidth="2" />}
      <rect width="32" height="32" fill="none" stroke="#161b22" strokeOpacity="0.25" />
    </g>);
  }
  if (!field && !interior) return <p role="status">このマップは存在しません。マップを選び直してください。</p>;
  return <section className="npc-placement" ref={ref} aria-label="NPC配置マップ">
    <p><strong>{field ? 'フィールド' : interior?.name}</strong> · {npc.name}</p>
    <p className="npc-map-help">タップで配置。保存するまで反映されません</p>
    {world.bundled && field && <p className="npc-map-help">同梱の地図</p>}
    <div className="npc-map-controls">
      <button type="button" onClick={() => { const p = normalize(initial); setCenter(p); setCursor(p); }}>NPCの位置へ</button>
      <label>広さ <select aria-label="地図の広さ" value={view} onChange={(e) => setZoom(Number(e.target.value))}>
        {[...new Set([Math.min(size, 9), Math.min(size, 13), Math.min(size, 17)])].map((v) => <option key={v} value={v} disabled={width / v < 24}>{v}マス</option>)}
      </select></label>
      <button type="button" aria-expanded={overview} onClick={() => setOverview((v) => !v)}>全体図</button>
    </div>
    {overview && <NpcOverview world={world} mapId={mapId} size={size} origin={origin} view={view} disabled={disabled} onJump={(p) => { if (disabled) return; const next = normalize(p); setCenter(next); setCursor(next); }} />}
    <svg className="npc-detail-map" role="application" aria-label="大きい地図でNPCを配置" aria-disabled={disabled} tabIndex={disabled ? -1 : 0} viewBox={`0 0 ${view * 32} ${view * 32}`} {...tap}
      onKeyDown={(e) => {
        if (disabled) return;
        const d: Record<string, Point> = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } };
        if (d[e.key]) {
          e.preventDefault(); const next = normalize({ x: cursor.x + d[e.key]!.x, y: cursor.y + d[e.key]!.y });
          setCursor(next); setCenter(next);
          const r = validateNpcPlacement(world, { ...npc, mapId, ...next }, draft);
          setNote(`(${next.x}, ${next.y}) ${r.reason ?? '配置できます。Enterで配置'}`);
        } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); place(normalize(cursor)); }
      }}>{cells}</svg>
    <div className="npc-map-controls npc-region-controls">
      {([['上へ', 0, -1], ['左へ', -1, 0], ['右へ', 1, 0], ['下へ', 0, 1]] as const).map(([label, dx, dy]) => <button key={label} type="button" onClick={() => { const next = normalize({ x: center.x + dx * Math.floor(view / 2), y: center.y + dy * Math.floor(view / 2) }); setCenter(next); setCursor(next); }}>{label}</button>)}
    </div>
    <p className="npc-map-help">黄枠: 選択中 · 白点線: 他のNPC · ×: 歩けない<br />宿: 宿屋 · 店: なんでも屋 · 門/街: 入口 · 着: 着地点 · 始: 開始地点</p>
    <p className="npc-map-help">この地図のNPC: {draft.filter((n) => npcMapId(n) === mapId).map((n) => `${n.name}${n.id === npc.id ? '（選択中）' : ''}`).join('、') || 'なし'}</p>
    <p role="status" className="npc-map-status">{note || '矢印キーでも場所を選べます。Enterで配置。'}</p>
  </section>;
}

function NpcOverview({ world, mapId, size, origin, view, onJump, disabled }: { disabled: boolean; world: NpcPlacementWorld; mapId: string; size: number; origin: Point; view: number; onJump: (p: Point) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tap = useMapTap(`overview/${mapId}/${size}`, size, (x, y) => onJump({ x, y }), disabled);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d'); if (!ctx) return;
    // Avoid scanning towns/gates for every overview pixel.
    const map = world.interiors.find((m) => m.id === mapId);
    paintTerrainOverview(ctx, 256, size, (x, y) => {
      const idx = map ? map.tiles[y * size + x]! : world.tiles[y * size + x]!;
      const terrain = map ? map.parts?.[idx]?.terrain ?? BASE_PALETTE[idx] ?? 'plains' : world.parts[idx]?.terrain ?? 'plains';
      return EDITOR_TERRAIN_COLORS[terrain as Terrain] ?? '#7a5cff';
    });
    const scale = 256 / size;
    if (mapId === WORLD_MAP_ID) for (const town of world.towns) {
      ctx.fillStyle = '#f5d442'; ctx.strokeStyle = '#3a2c00'; ctx.beginPath(); ctx.arc(town.x * scale, town.y * scale, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    // Split the toroidal viewport across both seams instead of drawing beyond the canvas.
    const spans = (v: number) => v + view <= size ? [[v, view]] : [[v, size - v], [0, view - (size - v)]];
    for (const [x, w] of spans(origin.x)) for (const [y, h] of spans(origin.y)) ctx.strokeRect(x! * scale, y! * scale, w! * scale, h! * scale);
  }, [world, mapId, size, origin.x, origin.y, view]);
  return <div><p className="npc-map-help">全体図は場所探し / 大きい地図で配置</p><canvas ref={ref} width={256} height={256} className="npc-overview" aria-label="全体図で表示領域を選ぶ" {...tap} /></div>;
}
