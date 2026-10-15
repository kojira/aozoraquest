/**
 * **ストーリーの仕組み** (D-STORY-009)。管理者 PDS の `world.story` に置く。
 * 置きアイテム (`placedItems`)・戦闘定義 (`battles`)・固定モンスター (`fieldMonsters`)。
 *
 * 置きアイテム: そのマスで「しらべる」と一度だけ手に入る。取ったことは `flag` で覚える
 * (`flag` は必須。フラグ数の上限検証に含めるため)。付与はすべて edge が権威。
 *
 * 戦闘定義: 敵は 1 種類で `count` 体 (1〜3)。勝てば `winFlag`、負ければ `loseFlag` (任意) を
 * edge が立てる。逃げた・逃げられたはフラグなし (再挑戦できる)。`canFlee: false` は逃げられない戦闘。
 * 固定モンスター: そのマスを踏むと戦闘。requireFlags がそろい winFlag が無いあいだだけ居る。
 *
 * 読み込みは scenario の後 (フラグ数を scenario.setFlags と合わせて数える)。monsters の後なので
 * monsterId の実在も見られる。
 */
import { ITEMS, MONSTERS_BY_ID } from './battle.js';
import { WORLD_MAP_ID } from './map-id.js';
import type { NpcDef } from './npc-data.js';
import type { GameQuestDef } from './quest-data.js';
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

/** ストーリー戦の定義。NPC の altLine.battle・クエストの startBattle・固定モンスターが id で引く。 */
export interface StoryBattleDef {
  id: string;
  monsterId: string;
  /** 同じ敵の数 (1〜3)。 */
  count: number;
  /** 勝ったら立てる (必須)。立っていればもう戦わない。 */
  winFlag: string;
  /** 負けたら立てる (任意)。 */
  loseFlag?: string;
  /** false なら「にげる」を出さない・受け付けない。省略 = true。 */
  canFlee?: boolean;
}

/** 固定モンスター: マップのマスに居て、踏むと戦闘になる。 */
export interface FieldMonsterDef {
  id: string;
  mapId: string;
  x: number;
  y: number;
  battleId: string;
  requireFlags?: string[];
  /** true ならマップに敵の絵を出す。 */
  sprite?: boolean;
}

/** world.story の中身 (updatedAt を除く)。 */
export interface StoryData {
  placedItems?: PlacedItemDef[];
  battles?: StoryBattleDef[];
  fieldMonsters?: FieldMonsterDef[];
}

export interface StoryRecord extends StoryData {
  placedItems: PlacedItemDef[];
  updatedAt: string;
}

export const MAX_PLACED_ITEMS = 200;
export const MAX_STORY_BATTLES = 200;
export const MAX_FIELD_MONSTERS = 200;

let placed: PlacedItemDef[] = [];
let bySpot = new Map<string, PlacedItemDef>();
let battles: StoryBattleDef[] = [];
let battleById = new Map<string, StoryBattleDef>();
let fieldMonsterList: FieldMonsterDef[] = [];
let fieldMonsterBySpot = new Map<string, FieldMonsterDef>();

const spot = (mapId: string, x: number, y: number) => `${mapId}:${x},${y}`;

/**
 * 出所を合わせたフラグ数 (scenario.setFlags + placedItems[].flag + battles[].winFlag/loseFlag) を
 * MAX_FLAGS と比べる。超えると state 側で古いフラグが切り捨てられ、アイテムを何度も拾えたり
 * ボスが復活したりする。
 */
export function assertStoryFlagTotal(events: readonly ScenarioEvent[], story: StoryData): void {
  const all = new Set([
    ...events.flatMap((e) => e.setFlags),
    ...(story.placedItems ?? []).map((p) => p.flag),
    ...(story.battles ?? []).flatMap((b) => (b.loseFlag ? [b.winFlag, b.loseFlag] : [b.winFlag])),
  ]);
  if (all.size > MAX_FLAGS) throw new StoryDataError(`フラグが多すぎる (シナリオとストーリーで ${all.size} > ${MAX_FLAGS})`);
}

/** いま読み込まれている story (フラグ数の検証で scenario 側から使う)。 */
export function currentStory(): StoryData {
  return { placedItems: placed, battles, fieldMonsters: fieldMonsterList };
}

function assertFlagList(list: unknown, where: string): void {
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new StoryDataError(`${where}: requireFlags が配列でない`);
  for (const f of list) if (!isFlagName(f)) throw new StoryDataError(`${where}: 条件のフラグ名が不正 (${f})`);
}

function validateBattles(list: readonly StoryBattleDef[]): void {
  if (list.length > MAX_STORY_BATTLES) throw new StoryDataError(`戦闘が多すぎる (${list.length} > ${MAX_STORY_BATTLES})`);
  const ids = new Set<string>();
  for (const b of list) {
    if (!b || typeof b.id !== 'string' || b.id.trim() === '') throw new StoryDataError('戦闘の id が空');
    if (ids.has(b.id)) throw new StoryDataError(`戦闘の id が重複 (${b.id})`);
    ids.add(b.id);
    if (!MONSTERS_BY_ID[b.monsterId]) throw new StoryDataError(`${b.id}: モンスターが存在しない (${b.monsterId})`);
    if (!Number.isInteger(b.count) || b.count < 1 || b.count > 3) throw new StoryDataError(`${b.id}: 敵の数は 1〜3`);
    if (!isFlagName(b.winFlag)) throw new StoryDataError(`${b.id}: 勝利フラグ名が不正 (${b.winFlag})`);
    if (b.loseFlag !== undefined && !isFlagName(b.loseFlag)) throw new StoryDataError(`${b.id}: 敗北フラグ名が不正 (${b.loseFlag})`);
    if (b.canFlee !== undefined && typeof b.canFlee !== 'boolean') throw new StoryDataError(`${b.id}: canFlee が真偽値でない`);
  }
}

function validateFieldMonsters(list: readonly FieldMonsterDef[], battleIds: ReadonlySet<string>): void {
  if (list.length > MAX_FIELD_MONSTERS) throw new StoryDataError(`固定モンスターが多すぎる (${list.length} > ${MAX_FIELD_MONSTERS})`);
  const ids = new Set<string>();
  const spots = new Set<string>();
  for (const m of list) {
    if (!m || typeof m.id !== 'string' || m.id.trim() === '') throw new StoryDataError('固定モンスターの id が空');
    if (ids.has(m.id)) throw new StoryDataError(`固定モンスターの id が重複 (${m.id})`);
    ids.add(m.id);
    if (typeof m.mapId !== 'string' || m.mapId.trim() === '') throw new StoryDataError(`${m.id}: マップ id が不正`);
    if (!Number.isInteger(m.x) || !Number.isInteger(m.y)) throw new StoryDataError(`${m.id}: 座標が整数でない`);
    if (spots.has(spot(m.mapId, m.x, m.y))) throw new StoryDataError(`${m.id}: 同じマスに 2 体置いている`);
    spots.add(spot(m.mapId, m.x, m.y));
    if (!battleIds.has(m.battleId)) throw new StoryDataError(`${m.id}: 戦闘が存在しない (${m.battleId})`);
    if (m.sprite !== undefined && typeof m.sprite !== 'boolean') throw new StoryDataError(`${m.id}: sprite が真偽値でない`);
    assertFlagList(m.requireFlags, m.id);
  }
}

/**
 * NPC の altLine.battle とクエストの startBattle が指す戦闘が無ければ、その説明を返す。
 * 保存のときだけ見る: story の保存 (参照中の戦闘を消す) と NPC・クエストの保存 (無い戦闘を指す)。
 * 読み込みでは見ない (参照切れで story 全体が消えると、置きアイテムまで消える)。
 */
export function missingStoryBattle(npcs: readonly NpcDef[], quests: readonly GameQuestDef[], battleIds: ReadonlySet<string> = new Set(battleById.keys())): string | null {
  for (const n of npcs) for (const a of n.altLines ?? []) if (a.battle !== undefined && !battleIds.has(a.battle)) return `NPC「${n.name}」のセリフが戦闘「${a.battle}」を参照している (戦闘が存在しない)`;
  for (const q of quests) if (q.startBattle !== undefined && !battleIds.has(q.startBattle)) return `クエスト「${q.title}」が戦闘「${q.startBattle}」を参照している (戦闘が存在しない)`;
  return null;
}

/** 検証する。**壊れた 1 件で全体を落とす**。フラグ数は現行のシナリオと合わせて数える。 */
export function validateStory(story: StoryData | null, events: readonly ScenarioEvent[] = scenarioEvents()): void {
  const next = story?.placedItems ?? [];
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
    assertFlagList(p.requireFlags, where);
  }
  const nextBattles = story?.battles ?? [];
  validateBattles(nextBattles);
  validateFieldMonsters(story?.fieldMonsters ?? [], new Set(nextBattles.map((b) => b.id)));
  assertStoryFlagTotal(events, story ?? {});
}

/** 検証して差し替える。`null` で全解除。 */
export function setStory(story: StoryData | null): void {
  validateStory(story);
  placed = (story?.placedItems ?? []).map((p) => ({ ...p, ...(p.requireFlags ? { requireFlags: [...p.requireFlags] } : {}) }));
  bySpot = new Map(placed.map((p) => [spot(p.mapId, p.x, p.y), p]));
  battles = (story?.battles ?? []).map((b) => ({ ...b }));
  battleById = new Map(battles.map((b) => [b.id, b]));
  fieldMonsterList = (story?.fieldMonsters ?? []).map((m) => ({ ...m, ...(m.requireFlags ? { requireFlags: [...m.requireFlags] } : {}) }));
  fieldMonsterBySpot = new Map(fieldMonsterList.map((m) => [spot(m.mapId, m.x, m.y), m]));
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

export function storyBattles(): readonly StoryBattleDef[] {
  return battles;
}

export function storyBattleById(id: string): StoryBattleDef | undefined {
  return battleById.get(id);
}

export function fieldMonsters(): readonly FieldMonsterDef[] {
  return fieldMonsterList;
}

/** そのマスの固定モンスター (居るかどうかは見ない)。 */
export function fieldMonsterAt(mapId: string, x: number, y: number): FieldMonsterDef | undefined {
  return fieldMonsterBySpot.get(spot(mapId, x, y));
}

/**
 * ストーリー戦の決着で立てるフラグ。勝ちは winFlag、負けは loseFlag (あれば)。
 * 逃げた・逃げられたは何も立てない (再挑戦できる)。
 */
export function flagsAfterStoryBattle(battle: Pick<StoryBattleDef, 'winFlag' | 'loseFlag'>, decision: string, flags: readonly string[]): string[] {
  const add = decision === 'win' ? battle.winFlag : decision === 'lose' ? battle.loseFlag : undefined;
  if (!add || flags.includes(add)) return [...flags];
  return [...flags, add].slice(-MAX_FLAGS);
}

/** その戦闘をいま始められるか: 条件のフラグがそろい、まだ勝っていない。 */
export function storyBattleOpen(def: StoryBattleDef, requireFlags: readonly string[] | undefined, flags: readonly string[]): boolean {
  return !flags.includes(def.winFlag) && (requireFlags ?? []).every((f) => flags.includes(f));
}
