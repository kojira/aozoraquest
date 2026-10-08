/**
 * **ストーリーの仕組み** (D-STORY-009)。管理者 PDS の `world.story` に置く。
 * いまは置きアイテム (`placedItems`) だけ。
 *
 * 置きアイテム: そのマスで「しらべる」と一度だけ手に入る。取ったことは `flag` で覚える
 * (`flag` は必須。フラグ数の上限検証に含めるため)。付与はすべて edge が権威。
 *
 * 読み込みは scenario の後 (フラグ数を scenario.setFlags と合わせて数える)。
 */
import { ITEMS } from './battle.js';
import { WORLD_MAP_ID } from './map-id.js';
import { isFlagName, MAX_FLAGS, scenarioEvents, type ScenarioEvent } from './scenario.js';
import { townAt } from './world.js';

export class StoryDataError extends Error {}

export interface PlacedItemDef {
  id: string;
  /** `world` = フィールド。内部マップは その id。 */
  mapId: string;
  x: number;
  y: number;
  itemId: string;
  count: number;
  /** 取ったら立てるフラグ。立っていれば二度と取れない。 */
  flag: string;
  /** すべて立っているときだけ取れる。 */
  requireFlags?: string[];
}

export interface StoryRecord {
  placedItems: PlacedItemDef[];
  updatedAt: string;
}

export const MAX_PLACED_ITEMS = 200;

let placed: PlacedItemDef[] = [];
let bySpot = new Map<string, PlacedItemDef>();

const spot = (mapId: string, x: number, y: number) => `${mapId}:${x},${y}`;

/**
 * 出所を合わせたフラグ数 (scenario.setFlags + placedItems[].flag) を MAX_FLAGS と比べる。
 * 超えると state 側で古いフラグが切り捨てられ、アイテムを何度も拾えてしまう。
 */
export function assertStoryFlagTotal(events: readonly ScenarioEvent[], items: readonly PlacedItemDef[]): void {
  const all = new Set([...events.flatMap((e) => e.setFlags), ...items.map((p) => p.flag)]);
  if (all.size > MAX_FLAGS) throw new StoryDataError(`フラグが多すぎる (シナリオと置きアイテムで ${all.size} > ${MAX_FLAGS})`);
}

/** 検証する。**壊れた 1 件で全体を落とす**。フラグ数は現行のシナリオと合わせて数える。 */
export function validateStory(list: readonly PlacedItemDef[] | null, events: readonly ScenarioEvent[] = scenarioEvents()): void {
  const next = list ?? [];
  if (next.length > MAX_PLACED_ITEMS) throw new StoryDataError(`置きアイテムが多すぎる (${next.length} > ${MAX_PLACED_ITEMS})`);
  const ids = new Set<string>();
  const spots = new Set<string>();
  for (const p of next) {
    if (!p || typeof p.id !== 'string' || p.id.trim() === '') throw new StoryDataError('置きアイテムの id が空');
    const where = p.id;
    if (ids.has(p.id)) throw new StoryDataError(`id が重複 (${p.id})`);
    ids.add(p.id);
    if (typeof p.mapId !== 'string' || p.mapId.trim() === '') throw new StoryDataError(`${where}: マップ id が不正`);
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) throw new StoryDataError(`${where}: 座標が整数でない`);
    // フィールドの町のマスでは しらべるが出ないので、置いても誰も取れない。
    if (p.mapId === WORLD_MAP_ID && townAt(p.x, p.y)) throw new StoryDataError(`${where}: フィールドの町のマスには置けない`);
    if (spots.has(spot(p.mapId, p.x, p.y))) throw new StoryDataError(`${where}: 同じマスに 2 つ置いている`);
    spots.add(spot(p.mapId, p.x, p.y));
    if (!ITEMS[p.itemId]) throw new StoryDataError(`${where}: アイテムが存在しない (${p.itemId})`);
    if (!Number.isInteger(p.count) || p.count < 1 || p.count > 99) throw new StoryDataError(`${where}: 個数は 1〜99`);
    if (!isFlagName(p.flag)) throw new StoryDataError(`${where}: フラグ名が不正 (${p.flag})`);
    if (p.requireFlags !== undefined) {
      if (!Array.isArray(p.requireFlags)) throw new StoryDataError(`${where}: requireFlags が配列でない`);
      for (const f of p.requireFlags) if (!isFlagName(f)) throw new StoryDataError(`${where}: 条件のフラグ名が不正 (${f})`);
    }
  }
  assertStoryFlagTotal(events, next);
}

/** 検証して差し替える。`null` で全解除。 */
export function setStory(list: readonly PlacedItemDef[] | null): void {
  validateStory(list);
  placed = (list ?? []).map((p) => ({ ...p, ...(p.requireFlags ? { requireFlags: [...p.requireFlags] } : {}) }));
  bySpot = new Map(placed.map((p) => [spot(p.mapId, p.x, p.y), p]));
}

export function placedItems(): readonly PlacedItemDef[] {
  return placed;
}

/** そのマスの置きアイテム (取得済みかどうかは見ない)。 */
export function placedItemAt(mapId: string, x: number, y: number): PlacedItemDef | undefined {
  return bySpot.get(spot(mapId, x, y));
}

/** いま取れるか: 条件のフラグがそろっていて、まだ取っていない。 */
export function placedItemAvailable(p: PlacedItemDef, flags: readonly string[]): boolean {
  return !flags.includes(p.flag) && (p.requireFlags ?? []).every((f) => flags.includes(f));
}
