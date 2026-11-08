/**
 * **置きアイテムの形と判定** (D-STORY-009 / D-CHEST-001)。保存と読み込みは story-data。
 *
 * 種類: `spot` (見えない。省略時) / `chest` (宝箱) / `sparkle` (キラキラ)。
 * 取ったことは `flag` があればフラグで、無ければ `GameState.openedSpots` (id の集合) で覚える。
 * 宝箱・キラキラはフラグを使わない (フラグは古い順に切り捨てられ、溢れると章の進行が壊れる)。
 * **id は変えてはいけない** — 変えると全員の宝箱が閉じた状態に戻る。
 */
import { ITEMS } from './battle.js';
import { EQUIPMENT_BY_ID } from './equipment.js';
import { isFlagName } from './scenario.js';

export type PlacedKind = 'spot' | 'chest' | 'sparkle';

export type PlacedReward =
  | { item: string; count: number }
  | { equipment: string }
  | { power: number };

export interface PlacedItemDef {
  id: string;
  /** `world` = フィールド。内部マップは その id。 */
  mapId: string;
  x: number;
  y: number;
  /** 省略 = spot (既存互換)。 */
  kind?: PlacedKind;
  /** 古い形。rewards が無いときは必須。 */
  itemId?: string;
  count?: number;
  /** 1〜3 件。あれば itemId/count より優先。 */
  rewards?: PlacedReward[];
  /** 取ったら立てるフラグ。spot は必須。chest/sparkle は物語の条件に使うときだけ。 */
  flag?: string;
  /** すべて立っているときだけ取れる。 */
  requireFlags?: string[];
  /** 1 行 (40 字まで)。鍵がかかっているとき・空のときに出す。 */
  hint?: string;
}

/** しらべた結果: 取る / 空の宝箱 / 鍵 (どちらも無料) / 普段の有料のしらべる。 */
export type PlacedSearchOutcome = 'take' | 'empty' | 'locked' | 'paid';

export const PLACED_KINDS: readonly PlacedKind[] = ['spot', 'chest', 'sparkle'];
export const MAX_PLACED_REWARDS = 3;
export const MAX_PLACED_POWER = 50;
export const MAX_PLACED_HINT = 40;

export function placedKind(p: PlacedItemDef): PlacedKind {
  return p.kind ?? 'spot';
}

/** 報酬を 1 つの形にそろえる (rewards、なければ [{item:itemId,count}])。 */
export function placedRewards(p: PlacedItemDef): PlacedReward[] {
  if (p.rewards) return p.rewards.map((r) => ({ ...r }));
  return p.itemId !== undefined ? [{ item: p.itemId, count: p.count ?? 1 }] : [];
}

/** もう取ったか: flag があればフラグで、無ければ openedSpots で見る。 */
export function placedItemTaken(p: PlacedItemDef, flags: readonly string[], opened: readonly string[]): boolean {
  return p.flag !== undefined ? flags.includes(p.flag) : opened.includes(p.id);
}

/** いま取れるか: 条件のフラグがそろっていて、まだ取っていない。 */
export function placedItemOpen(p: PlacedItemDef, flags: readonly string[], opened: readonly string[]): boolean {
  return (p.requireFlags ?? []).every((f) => flags.includes(f)) && !placedItemTaken(p, flags, opened);
}

/**
 * しらべた結果を決める (edge の分岐と web のメニュー表示が同じものを使う)。
 * 条件のそろわない宝箱 (描かれない) と hint の無い spot の鍵は、存在を漏らさないよう普段のしらべる (paid) のまま。
 */
export function placedSearchOutcome(p: PlacedItemDef, flags: readonly string[], opened: readonly string[]): PlacedSearchOutcome {
  const kind = placedKind(p);
  if (!(p.requireFlags ?? []).every((f) => flags.includes(f))) return kind === 'spot' && p.hint ? 'locked' : 'paid';
  if (!placedItemTaken(p, flags, opened)) return 'take';
  return kind === 'chest' ? 'empty' : 'paid';
}

/** 1 件の形を確かめる (id の重複・マスの重なりは story-data が見る)。 */
export function placedItemIssue(p: PlacedItemDef): string | null {
  const kind = p.kind ?? 'spot';
  if (!PLACED_KINDS.includes(kind)) return `種類が不正 (${String(p.kind)})`;
  if (p.rewards !== undefined) {
    if (!Array.isArray(p.rewards) || p.rewards.length < 1 || p.rewards.length > MAX_PLACED_REWARDS) return `報酬は 1〜${MAX_PLACED_REWARDS} 件`;
    for (const r of p.rewards) {
      const issue = rewardIssue(r);
      if (issue) return issue;
    }
  } else {
    if (p.itemId === undefined || !ITEMS[p.itemId]) return `アイテムが存在しない (${p.itemId})`;
    if (ITEMS[p.itemId]!.casinoOnly) return `カジノの景品は置けない (${p.itemId})`;
    if (!Number.isInteger(p.count) || p.count! < 1 || p.count! > 99) return '個数は 1〜99';
  }
  if (kind === 'spot' && p.flag === undefined) return 'しらべる場所はフラグが必須';
  if (p.flag !== undefined && !isFlagName(p.flag)) return `フラグ名が不正 (${p.flag})`;
  if (p.hint !== undefined && (typeof p.hint !== 'string' || p.hint.trim() === '' || p.hint.length > MAX_PLACED_HINT || /[\r\n]/.test(p.hint))) return `hint は 1 行・${MAX_PLACED_HINT} 字まで`;
  return null;
}

function rewardIssue(r: PlacedReward): string | null {
  if (!r || typeof r !== 'object') return '報酬の形が不正';
  const keys = Object.keys(r).sort().join(',');
  if (keys === 'count,item' && 'item' in r) {
    if (!ITEMS[r.item]) return `アイテムが存在しない (${r.item})`;
    if (ITEMS[r.item]!.casinoOnly) return `カジノの景品は置けない (${r.item})`;
    return Number.isInteger(r.count) && r.count >= 1 && r.count <= 99 ? null : '個数は 1〜99';
  }
  if (keys === 'equipment' && 'equipment' in r) {
    const def = EQUIPMENT_BY_ID[r.equipment];
    if (!def) return `装備が存在しない (${r.equipment})`;
    return def.casinoOnly ? `カジノの景品は置けない (${r.equipment})` : null;
  }
  if (keys === 'power' && 'power' in r) return Number.isInteger(r.power) && r.power >= 1 && r.power <= MAX_PLACED_POWER ? null : `パワーは 1〜${MAX_PLACED_POWER}`;
  return '報酬の形が不正';
}
