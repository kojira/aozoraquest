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
import { ITEMS } from './battle.js';

export class ShopDataError extends Error {}

/** 店 1 軒の上書き。指定したフィールドだけ生成を置き換える。 */
export interface ShopOverride {
  /** 街の座標 (townShopStock と同じキー)。 */
  x: number;
  y: number;
  /** 装備のラインナップ (EQUIPMENT の id)。 */
  equipment?: string[];
  /** 消耗品 (ITEMS の id)。 */
  consumables?: string[];
  /** 値札の素材 (ITEMS の id)。 */
  materialId?: string;
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
    }
    for (const id of s.consumables ?? []) {
      if (!ITEMS[id]) throw new ShopDataError(`${where}: どうぐ id が存在しない (${id})`);
    }
    if (s.materialId !== undefined && !ITEMS[s.materialId]) {
      throw new ShopDataError(`${where}: 素材 id が存在しない (${s.materialId})`);
    }
    next.set(key(s.x, s.y), { ...s, equipment: s.equipment ? [...s.equipment] : undefined, consumables: s.consumables ? [...s.consumables] : undefined } as ShopOverride);
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
