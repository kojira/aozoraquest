/**
 * **NPC** (#425)。マップに置ける「話しかけられる人」。
 *
 * DQ の作法: NPC はタイルを 1 つ占め、**歩いてぶつかると会話が始まる** (移動はしない)。
 * 通り抜けられると「人」に見えないので、移動判定でも塞ぐ — **web と edge の両方**が
 * この一覧を見る (移動はサーバーが権威。片方だけだと、画面では人がいるのに
 * サーバーは素通りさせる、という食い違いになる)。
 *
 * 保存先は管理者 PDS の `world.npcs` (マップ #421 / モンスター #419 と同じ流儀)。
 * 絵はドット絵 (`npc:<id>` キー) で、無ければ代替の見た目に倒す。
 */

import { assertItemRequirements, isFlagName, itemsSatisfied, type ItemRequirement } from './scenario.js';
import { ITEMS } from './battle.js';
import { WORLD_MAP_ID } from './map-id.js';

export class NpcDataError extends Error {}

export interface NpcDef {
  id: string;
  /** 名前 (会話の話者として出る)。 */
  name: string;
  /**
   * **立っているマップ** (#613)。内部マップ (#424) の id、**省略 = フィールド**
   * (`WORLD_MAP_ID`)。mapId の無い旧レコードは無移行でフィールドの NPC として読める。
   */
  mapId?: string;
  /** 立ち位置 (そのマップの座標。フィールドはトーラスで丸める)。 */
  x: number;
  y: number;
  /** セリフ (1 要素 = 1 窓)。ぶつかるたびに先頭から流す。 */
  lines: string[];
  /**
   * **進行フラグで変わるセリフ** (#545)。上から順に見て、条件を満たす最初のものを話す。
   * どれも満たさなければ `lines` (既定のセリフ)。
   *
   * 「橋を直したら村人の話が変わる」を、NPC を作り直さずに書けるようにする。
   */
  altLines?: Array<{
    /** すべて立っていること。 */
    flags?: string[];
    /** どれも立っていないこと。 */
    notFlags?: string[];
    /** 持っていること (#426)。フラグの代わりに「これを持っていたら別の話をする」。 */
    items?: ItemRequirement[];
    lines: string[];
  }>;
}

export interface NpcsRecord {
  npcs: NpcDef[];
  updatedAt: string;
}

/** 1 セリフの最大長 (DQ の窓に収まる範囲)。 */
export const MAX_NPC_LINE = 120;
/** NPC の総数の上限 (レコードサイズの現実的な範囲)。 */
export const MAX_NPCS = 500;

let npcList: NpcDef[] = [];
let byKey = new Map<string, NpcDef>();

const WORLD = 1024;
const wrapW = (v: number) => ((v % WORLD) + WORLD) % WORLD;
/** その NPC のマップ (省略 = フィールド)。 */
const mapOf = (n: Pick<NpcDef, 'mapId'>): string => n.mapId ?? WORLD_MAP_ID;
/**
 * マスのキー。フィールドはトーラスで丸め、内部マップは折り返さない (#424 と同じ規則。
 * 内部で丸めると、範囲外の座標が別のマスに化けて見つからない NPC になる)。
 */
const key = (mapId: string, x: number, y: number) =>
  mapId === WORLD_MAP_ID ? `${WORLD_MAP_ID}:${wrapW(x)},${wrapW(y)}` : `${mapId}:${x},${y}`;

/**
 * NPC 一覧を差し替える。`null` / 空で全解除。
 * **壊れた 1 人で全体を落とす** (部分適用しない。他エディタと同じ流儀)。
 */
export function setNpcs(list: readonly NpcDef[] | null): void {
  const next = list ?? [];
  if (next.length > MAX_NPCS) throw new NpcDataError(`NPC が多すぎる (${next.length} > ${MAX_NPCS})`);
  const ids = new Set<string>();
  const spots = new Set<string>();
  for (const n of next) {
    const where = n?.id ?? '(id なし)';
    if (!n || typeof n.id !== 'string' || n.id.trim() === '') throw new NpcDataError('NPC の id が空');
    if (ids.has(n.id)) throw new NpcDataError(`NPC の id が重複 (${n.id})`);
    ids.add(n.id);
    if (typeof n.name !== 'string' || n.name.trim() === '') throw new NpcDataError(`${where}: 名前が空`);
    if (!Number.isInteger(n.x) || !Number.isInteger(n.y)) throw new NpcDataError(`${where}: 座標が整数でない`);
    // マップの実在・範囲はここでは見ない — NPC は内部マップより先に読み込まれる
    // (読み込み順に依存する検証は、順序が変わった日に全 NPC を落とす)。エディタが見る。
    if (n.mapId !== undefined && (typeof n.mapId !== 'string' || n.mapId.trim() === '')) {
      throw new NpcDataError(`${where}: マップ id が不正`);
    }
    const k = key(mapOf(n), n.x, n.y);
    // **同じマスに 2 人は立てない。** ぶつかったときどちらと話すのか決められない。
    if (spots.has(k)) throw new NpcDataError(`${where}: 同じマスに別の NPC がいる (${n.x}, ${n.y})`);
    spots.add(k);
    if (!Array.isArray(n.lines) || n.lines.length === 0) throw new NpcDataError(`${where}: セリフが無い`);
    for (const l of n.lines) {
      if (typeof l !== 'string' || l.trim() === '' || l.length > MAX_NPC_LINE) {
        throw new NpcDataError(`${where}: セリフが不正 (空 or ${MAX_NPC_LINE} 文字超)`);
      }
    }
    for (const alt of n.altLines ?? []) {
      if (!alt || !Array.isArray(alt.lines) || alt.lines.length === 0) throw new NpcDataError(`${where}: フラグ別セリフが空`);
      for (const l of alt.lines) {
        if (typeof l !== 'string' || l.trim() === '' || l.length > MAX_NPC_LINE) {
          throw new NpcDataError(`${where}: フラグ別セリフが不正`);
        }
      }
      assertItemRequirements(alt.items, where, (id) => !!ITEMS[id]);
      // 条件の無い分岐は既定のセリフと同じなので、書き間違い (フラグ名の打ち漏らし) を疑う。
      if ((alt.flags?.length ?? 0) === 0 && (alt.notFlags?.length ?? 0) === 0 && (alt.items?.length ?? 0) === 0) {
        throw new NpcDataError(`${where}: フラグ別セリフに条件が無い`);
      }
      // シナリオ側と同じ書式で弾く (#545)。typo したフラグの分岐は永久に選ばれない。
      for (const f of [...(alt.flags ?? []), ...(alt.notFlags ?? [])]) {
        if (!isFlagName(f)) throw new NpcDataError(`${where}: フラグ名が不正 (${f})`);
      }
    }
  }
  npcList = next.map((n) => ({ ...n, lines: [...n.lines], ...(n.altLines ? { altLines: n.altLines.map((a) => ({ ...a, lines: [...a.lines], ...(a.items ? { items: a.items.map((r) => ({ ...r })) } : {}) })) } : {}) }));
  byKey = new Map(npcList.map((n) => [key(mapOf(n), n.x, n.y), n]));
}

/** そのマップ・そのマスの NPC (居なければ undefined)。移動判定と会話の両方が使う。 */
export function npcAt(mapId: string, x: number, y: number): NpcDef | undefined {
  return byKey.get(key(mapId, x, y));
}

/** 全 NPC (エディタ用)。 */
export function allNpcs(): readonly NpcDef[] {
  return npcList;
}

/** そのマップに立っている NPC (描画用)。フィールドは `WORLD_MAP_ID`。 */
export function npcsOn(mapId: string): readonly NpcDef[] {
  return npcList.filter((n) => mapOf(n) === mapId);
}

/**
 * その NPC が今話すセリフ (#545)。フラグ別の分岐を上から見て、
 * 最初に条件を満たしたものを返す。満たすものが無ければ既定のセリフ。
 */
export function npcLinesFor(npc: NpcDef, flags: readonly string[], materials: Readonly<Record<string, number>> = {}): string[] {
  for (const alt of npc.altLines ?? []) {
    if (alt.flags?.some((f) => !flags.includes(f))) continue;
    if (alt.notFlags?.some((f) => flags.includes(f))) continue;
    if (!itemsSatisfied(alt.items, materials)) continue;
    return alt.lines;
  }
  return npc.lines;
}

/** NPC の絵のキー (ドット絵の登録簿に相乗り)。 */
export function npcArtKey(id: string): string {
  return `npc:${id}`;
}
