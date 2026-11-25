/**
 * **店ごとのラインナップの上書き** (#422)。
 *
 * 品揃えは `townShopStock` が街の座標から**決定的に生成**していて、狙って変えられない
 * (街を 1 タイル動かすと品揃えが全部変わる、という副作用しかなかった)。
 * 店ごとに明示のラインナップを持てるようにする。
 *
 * - **上書きが無い店は従来どおり生成** — 全 53 店を手で埋めさせない。
 *   「この店だけ品揃えを決めたい」を差分で足す
 * - 保存先は管理者 PDS の `world.shops` (モンスター #419 / アイテム #420 と同じ流儀)。
 *   **edge も読む** — 品揃えと値段は edge が権威 (`shopCraft` が `not_in_stock` を弾く) なので、
 *   web だけが上書きを見ていると「見えるのに買えない」が起きる
 * - **壊れた 1 件で全体を落とす** (部分適用しない)
 */
import { EQUIPMENT_BY_ID } from './equipment.js';
import { ITEMS, MONSTERS_BY_ID } from './battle.js';
import { ELEMENT_LABELS, type Element } from './elements.js';
import { characterTokenIssue } from './character-data.js';

export class ShopDataError extends Error {}

/** 店主のセリフ (#385)。DQ 風に短く。過剰にしない (DESIGN.md の情報量の美意識)。 */
export interface ShopKeeper {
  /** 店主の名前。省略時は出さない (名前より口上が主役)。 */
  name?: string;
  /** 入店時のひとこと。 */
  greeting?: string;
  /** 作ってもらったとき。 */
  craft?: string;
  /** ひきとってもらったとき。 */
  sell?: string;
  /** きたえてもらったとき。 */
  forge?: string;
}

/** 店 1 軒の上書き。指定したフィールドだけ生成を置き換える。 */
export interface ShopOverride {
  /** 街の座標 (townShopStock と同じキー)。 */
  x: number;
  y: number;
  /** 装備のラインナップ (EQUIPMENT の id)。 */
  equipment?: string[];
  /** 消耗品 (ITEMS の id)。 */
  consumables?: string[];
  /** 町のテーマの属性 (D-MATERIAL-001)。値札・魔石の交換の魔石と、まわりの「よく出る敵」が決まる。 */
  theme?: Element;
  /** まわりの「よく出る敵」の上書き (その tier の敵の id)。無ければテーマの属性の敵。 */
  favoredMonsterId?: string;
  /** 魔石の交換 (その町の魔石だけで買える品。パワーはいらない)。 */
  exchange?: ShopExchangeEntry[];
  /** 店主 (#385)。 */
  keeper?: ShopKeeper;
}

/** 魔石の交換の 1 品。どうぐ (ITEMS) か装備 (EQUIPMENT) のどちらか 1 つと、町の魔石の数。 */
export type ShopExchangeEntry = ({ itemId: string; equipmentId?: undefined } | { equipmentId: string; itemId?: undefined }) & { stones: number };

/** 1 店の交換の品の数の上限。 */
export const MAX_SHOP_EXCHANGE = 4;

/** セリフの最大長。長文は DQ の窓に収まらず、情報量の美意識にも反する。 */
export const MAX_KEEPER_LINE = 60;

/** 既定のセリフ (街のハッシュで決定的に選ぶ = 店ごとに口調が違う)。 */
const GREETINGS = ['いらっしゃい！', 'よく来たね。ゆっくりしていきな。', 'おや、旅の人かい。', 'いらっしゃい。掘り出しものがあるよ。'] as const;
const CRAFTS = ['ほらよ、できたてだ！', 'いい仕上がりだよ。', 'だいじに使いなよ。'] as const;
const SELLS = ['まいど！', 'たしかに受け取ったよ。', 'いいものを持ってるね。'] as const;
const FORGES = ['うんと硬くなったよ！', 'これぞ職人技さ。', 'なかなかの一品になったね。'] as const;

/**
 * その店の店主 (上書き + 既定の合成)。既定は街の座標から決定的に選ぶので、
 * 店ごとに口調が違い、いつ来ても同じ人がいる。
 */
export function shopKeeperFor(x: number, y: number): Required<Omit<ShopKeeper, 'name'>> & { name?: string } {
  const h = ((x * 92821) ^ (y * 68917)) >>> 0;
  const over = overrides.get(key(x, y))?.keeper;
  const base = {
    greeting: GREETINGS[h % GREETINGS.length]!,
    craft: CRAFTS[(h >> 3) % CRAFTS.length]!,
    sell: SELLS[(h >> 6) % SELLS.length]!,
    forge: FORGES[(h >> 9) % FORGES.length]!,
  };
  return {
    ...base,
    ...(over?.greeting ? { greeting: over.greeting } : {}),
    ...(over?.craft ? { craft: over.craft } : {}),
    ...(over?.sell ? { sell: over.sell } : {}),
    ...(over?.forge ? { forge: over.forge } : {}),
    ...(over?.name ? { name: over.name } : {}),
  };
}

export interface ShopsRecord {
  shops: ShopOverride[];
  updatedAt: string;
}

let overrides = new Map<string, ShopOverride>();

const key = (x: number, y: number) => `${x},${y}`;

/**
 * 上書きを差し替える。`null` で全解除 (生成へ戻す)。
 *
 * **未知の id は保存で弾く。** 品揃えに存在しない装備 id が入っても買えないだけで
 * エラーにならず、「並んでいるのに買えない店」を静かに作る。
 */
export function setShopOverrides(list: readonly ShopOverride[] | null): void {
  const next = new Map<string, ShopOverride>();
  for (const s of list ?? []) {
    const where = `(${s?.x}, ${s?.y})`;
    if (!s || !Number.isInteger(s.x) || !Number.isInteger(s.y)) throw new ShopDataError(`座標が不正 ${where}`);
    if (next.has(key(s.x, s.y))) throw new ShopDataError(`同じ街の上書きが重複 ${where}`);
    for (const id of s.equipment ?? []) {
      if (!EQUIPMENT_BY_ID[id]) throw new ShopDataError(`${where}: 装備 id が存在しない (${id})`);
      if (EQUIPMENT_BY_ID[id]!.casinoOnly) throw new ShopDataError(`${where}: カジノの景品は店に並べられない (${id})`);
    }
    for (const id of s.consumables ?? []) {
      if (!ITEMS[id]) throw new ShopDataError(`${where}: どうぐ id が存在しない (${id})`);
      if (ITEMS[id]!.casinoOnly) throw new ShopDataError(`${where}: カジノの景品は店に並べられない (${id})`);
    }
    if (s.theme !== undefined && !(s.theme in ELEMENT_LABELS)) throw new ShopDataError(`${where}: テーマの属性が不正 (${String(s.theme)})`);
    if (s.favoredMonsterId !== undefined && !MONSTERS_BY_ID[s.favoredMonsterId]) {
      throw new ShopDataError(`${where}: よく出る敵の id が存在しない (${s.favoredMonsterId})`);
    }
    const exchangeIssue = exchangeIssueOf(s.exchange);
    if (exchangeIssue) throw new ShopDataError(`${where}: 魔石の交換の${exchangeIssue}`);
    if (s.keeper) {
      for (const [k, v] of Object.entries(s.keeper)) {
        if (v !== undefined && (typeof v !== 'string' || v.length > MAX_KEEPER_LINE)) {
          throw new ShopDataError(`${where}: 店主の ${k} が不正 (${MAX_KEEPER_LINE} 文字まで)`);
        }
        const issue = typeof v === 'string' ? characterTokenIssue(v) : null;
        if (issue) throw new ShopDataError(`${where}: 店主の ${k} の${issue}`);
      }
    }
    next.set(key(s.x, s.y), {
      ...s,
      equipment: s.equipment ? [...s.equipment] : undefined,
      consumables: s.consumables ? [...s.consumables] : undefined,
      exchange: s.exchange ? s.exchange.map((e) => ({ ...e })) : undefined,
    } as ShopOverride);
  }
  overrides = next;
}

/** その店の上書き (無ければ undefined = 生成のまま)。townShopStock が参照する。 */
export function shopOverrideAt(x: number, y: number): ShopOverride | undefined {
  return overrides.get(key(x, y));
}

/** エディタ用: 現在の上書き一覧。 */
export function shopOverrides(): ShopOverride[] {
  return [...overrides.values()].map((s) => ({ ...s }));
}

/** 交換の品の形を確かめる (問題なければ null)。 */
function exchangeIssueOf(list: readonly ShopExchangeEntry[] | undefined): string | null {
  if (list === undefined) return null;
  if (!Array.isArray(list) || list.length > MAX_SHOP_EXCHANGE) return `品は ${MAX_SHOP_EXCHANGE} 品まで`;
  const seen = new Set<string>();
  for (const e of list) {
    if (!e || typeof e !== 'object') return '形が不正';
    if (!Number.isInteger(e.stones) || e.stones < 1 || e.stones > 99) return `魔石の数は 1〜99 の整数 (${String(e.stones)})`;
    const hasItem = typeof e.itemId === 'string';
    const hasEquip = typeof e.equipmentId === 'string';
    if (hasItem === hasEquip) return 'itemId か equipmentId のどちらか 1 つ';
    const id = (hasItem ? e.itemId : e.equipmentId)!;
    if (seen.has(id)) return `品が重複 (${id})`;
    seen.add(id);
    if (hasItem) {
      if (!ITEMS[id]) return `どうぐ id が存在しない (${id})`;
      if (ITEMS[id]!.key) return `だいじなものは置けない (${id})`;
    } else {
      if (!EQUIPMENT_BY_ID[id]) return `装備 id が存在しない (${id})`;
    }
  }
  return null;
}
