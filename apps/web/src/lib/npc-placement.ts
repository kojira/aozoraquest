import {
  allGates, allInteriors, BASE_PALETTE, isKnownTerrain, isWalkable, partArtFor, npcArtKey, tileArtFor,
  worldMapTiles, worldOverlay, worldParts, WORLD_MAP_ID, WORLD_SIZE, wrap,
  type Gate, type InteriorMap, type NpcDef, type TileArt, type Town, type WorldPart, type Terrain,
} from '@aozoraquest/core';

export interface NpcPlacementWorld {
  tiles: Uint8Array;
  parts: readonly WorldPart[];
  interiors: readonly InteriorMap[];
  gates: readonly Gate[];
  towns: readonly Town[];
  overlay: ReadonlyMap<number, 'town' | 'bridge'>;
  spawn: { x: number; y: number };
  arts: ReadonlyMap<string, TileArt>;
  bundled: boolean;
}
/** Editor-local snapshot: another editor's global changes cannot change the displayed terrain or its rules. */
export function captureNpcPlacementWorld(npcs: readonly NpcDef[], bundled: boolean): NpcPlacementWorld {
  const tiles = worldMapTiles();
  if (!tiles) throw new Error('地図が読み込まれていない');
  const parts = structuredClone(worldParts());
  const interiors = structuredClone(allInteriors());
  const overlay = worldOverlay();
  const arts = new Map<string, TileArt>();
  const keep = (key: string, art: TileArt | undefined) => { if (art) arts.set(key, structuredClone(art)); };
  parts.forEach((p, i) => keep(`part:${i}`, partArtFor(i, p.terrain)));
  for (const terrain of new Set([...BASE_PALETTE, ...interiors.flatMap((m) => (m.parts ?? parts).map((p) => p.terrain))])) keep(terrain, tileArtFor(terrain));
  for (const n of npcs) keep(npcArtKey(n.id), tileArtFor(npcArtKey(n.id)));
  return { tiles: tiles.slice(), parts, interiors, gates: structuredClone(allGates()), towns: structuredClone(overlay.towns),
    spawn: { ...overlay.spawn }, overlay: new Map(overlay.overlayMap), arts, bundled };
}
export const npcMapId = (n: Pick<NpcDef, 'mapId'>) => n.mapId ?? WORLD_MAP_ID;
export function sameNpcPosition(a: NpcDef, b: NpcDef): boolean {
  return npcMapId(a) === npcMapId(b) && (npcMapId(a) === WORLD_MAP_ID
    ? wrap(a.x) === wrap(b.x) && wrap(a.y) === wrap(b.y) : a.x === b.x && a.y === b.y);
}
export function placementCell(world: NpcPlacementWorld, mapId: string, x: number, y: number) {
  const field = mapId === WORLD_MAP_ID;
  const map = world.interiors.find((m) => m.id === mapId);
  if (!field && (!map || x < 0 || y < 0 || x >= map.size || y >= map.size)) return null;
  if (field) { x = wrap(x); y = wrap(y); }
  const index = field ? world.tiles[y * WORLD_SIZE + x]! : map!.tiles[y * map!.size + x]!;
  const terrain = field
    ? (isKnownTerrain(world.parts[index]?.terrain ?? '') ? world.parts[index]!.terrain : 'plains')
    : map!.parts?.[index]?.terrain ?? BASE_PALETTE[index] ?? 'plains';
  const ownWalkable = (map?.parts ?? world.parts)[index]?.walkable;
  const walkable = ownWalkable ?? isWalkable(terrain as Terrain);
  const point = (p: { x: number; y: number }) => (field ? wrap(p.x) === x && wrap(p.y) === y : p.x === x && p.y === y);
  const gate = world.gates.some((g) => g.from.mapId === mapId && point(g.from));
  const town = field ? world.towns.find(point) : undefined;
  const facility = map?.inn && point(map.inn) ? '宿屋' : map?.shop && point(map.shop) ? 'なんでも屋' : gate ? 'ゲート' : undefined;
  const landing = world.gates.some((g) => g.to.mapId === mapId && point(g.to));
  const spawn = field && point(world.spawn);
  // Custom interior indices are not field part indices.
  const art = map?.parts ? world.arts.get(terrain) : world.arts.get(`part:${index}`) ?? world.arts.get(terrain);
  return { x, y, terrain, walkable, facility, town, landing, spawn, art };
}
export function validateNpcPlacement(world: NpcPlacementWorld, candidate: NpcDef, draft: readonly NpcDef[]): { position: Pick<NpcDef, 'mapId' | 'x' | 'y'>; reason?: never } | { reason: string; position?: never } {
  if (!Number.isInteger(candidate.x) || !Number.isInteger(candidate.y)) return { reason: '座標は整数で指定してください' };
  const mapId = npcMapId(candidate);
  if (mapId !== WORLD_MAP_ID && !world.interiors.some((m) => m.id === mapId)) return { reason: 'このマップは存在しません' };
  const c = placementCell(world, mapId, candidate.x, candidate.y);
  if (!c) return { reason: 'マップの外には置けません' };
  if (c.facility) return { reason: `${c.facility}の入口には置けません` };
  if (c.town || (mapId === WORLD_MAP_ID && c.terrain === 'town')) return { reason: '街の入口には置けません' };
  if (!c.walkable) return { reason: '壁・水などで歩けないマスには置けません' };
  const other = draft.find((n) => n.id !== candidate.id && sameNpcPosition(n, candidate));
  if (other) return { reason: `「${other.name}」がいます` };
  return { position: { mapId, x: c.x, y: c.y } };
}
/** Legacy terrain warnings stay compatible; invalid map/range/facility still block saving. */
export function npcStructuralPlacementError(world: NpcPlacementWorld, npc: NpcDef): string | null {
  const cell = placementCell(world, npcMapId(npc), npc.x, npc.y);
  if (!cell) return 'マップが存在しないか、マップの外にいます';
  return cell.facility ? `${cell.facility}の入口を塞いでいます` : null;
}
