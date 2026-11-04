/**
 * **置きアイテムを置くマスの確認** (D-CHEST-001 §7)。保存のときだけ見る — 読み込みで落とすと
 * 地形や NPC を後から動かしただけで story 全体 (物語のキーアイテムまで) が消える。
 * マスの見方は NPC の配置と同じ `placementCell` を使う (宿屋・店・ゲートの扉、歩けるか)。
 */
import { WORLD_MAP_ID } from './map-id.js';
import type { NpcDef } from './npc-data.js';
import { npcMapId, placementCell, sameNpcPosition, type NpcPlacementWorld } from './npc-placement.js';
import { placedKind, type PlacedItemDef } from './placed-items.js';

/** 置けない理由 (置けるなら null)。固定モンスターは同じマスで戦闘が先に始まるので避ける。 */
export function placedItemPlacementIssue(world: NpcPlacementWorld, p: PlacedItemDef, npcs: readonly NpcDef[], fieldMonsters: readonly { mapId: string; x: number; y: number }[]): string | null {
  const c = placementCell(world, p.mapId, p.x, p.y);
  if (!c) return 'マップの外か、存在しないマップには置けない';
  if (c.facility) return `${c.facility}の扉には置けない`;
  if (c.town || (p.mapId === WORLD_MAP_ID && c.terrain === 'town')) return '街の入口には置けない';
  if (!c.walkable) return '壁・水などで歩けないマスには置けない';
  const npc = npcs.find((n) => sameNpcPosition(n, { ...n, mapId: p.mapId, x: p.x, y: p.y }));
  if (npc) return `「${npc.name}」がいるマスには置けない`;
  if (fieldMonsters.some((m) => m.mapId === p.mapId && m.x === c.x && m.y === c.y)) return '固定モンスターのマスには置けない';
  return null;
}

/**
 * 内部マップで、入口 (ゲートの着地点) から歩いて行けるか。**警告だけ** に使う
 * (壁の向こうの宝箱をわざと置くこともある)。フィールドは広すぎるので見ない (常に true)。
 */
export function placedItemReachable(world: NpcPlacementWorld, p: PlacedItemDef, npcs: readonly NpcDef[]): boolean {
  if (p.mapId === WORLD_MAP_ID) return true;
  const map = world.interiors.find((m) => m.id === p.mapId);
  if (!map) return false;
  const blocked = new Set(npcs.filter((n) => npcMapId(n) === p.mapId).map((n) => `${n.x},${n.y}`));
  const open = (x: number, y: number) => !blocked.has(`${x},${y}`) && !!placementCell(world, p.mapId, x, y)?.walkable;
  const queue = world.gates.filter((g) => g.to.mapId === p.mapId).map((g) => ({ x: g.to.x, y: g.to.y }));
  const seen = new Set(queue.map((q) => `${q.x},${q.y}`));
  while (queue.length) {
    const { x, y } = queue.shift()!;
    if (x === p.x && y === p.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (seen.has(k) || nx < 0 || ny < 0 || nx >= map.size || ny >= map.size) continue;
      seen.add(k);
      // 置きアイテムのマス自体は (NPC がいなければ) 踏める。
      if (open(nx, ny) || (nx === p.x && ny === p.y && !blocked.has(k))) queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

/**
 * 保存のときの配置の確認: **新しく置いた・動かした** 置きアイテムだけを見る (既存のものは
 * 地形や NPC を後から変えても保存を止めない)。保存済みの id の flag・kind は変えさせない
 * (取ったかどうかの記録先が変わり、全員の取得状態が食い違う)。最初の問題を `id: 理由` で返す。
 */
export function placedItemsSaveIssue(world: NpcPlacementWorld, next: readonly PlacedItemDef[], before: readonly PlacedItemDef[], npcs: readonly NpcDef[], fieldMonsters: readonly { mapId: string; x: number; y: number }[]): string | null {
  for (const p of next) {
    const old = before.find((o) => o.id === p.id);
    if (old && old.flag !== p.flag) return `${p.id}: 保存済みの置きアイテムの flag は変えられない`;
    if (old && placedKind(old) !== placedKind(p)) return `${p.id}: 保存済みの置きアイテムの種類は変えられない`;
    if (old && old.mapId === p.mapId && old.x === p.x && old.y === p.y) continue;
    const issue = placedItemPlacementIssue(world, p, npcs, fieldMonsters);
    if (issue) return `${p.id}: ${issue}`;
  }
  return null;
}
