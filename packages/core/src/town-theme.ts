/**
 * **町のテーマの属性と、地方の「よく出る敵」** (D-MATERIAL-001)。
 *
 * - 町のテーマは店のデータ (`ShopOverride.theme`) に置く。無い町は、今の「よく出る敵」の属性。
 * - 町のある地方では、「よく出る敵」はテーマの属性の敵 (その tier のプールで先に並ぶ 1 体。めずらしい敵は除く)。
 *   店のデータの `favoredMonsterId` でほかの敵にもできる。町の無い地方・合う敵がいない地方は今のまま (場所のハッシュ)。
 * - 遭遇 (edge) と画面の「よく出る敵」(web) は、どちらも `regionFavorAffinity` を使う (同じ敵を指す)。
 */
import type { Element } from './elements.js';
import { type MonsterDef, type Tier, randomPool } from './battle-monsters.js';
import { shopOverrideAt, type ShopExchangeEntry } from './shop-data.js';
import { regionAffinity, worldOverlay, type Town } from './world.js';
import { STONE_IDS, monsterStoneElement } from './mana-stones.js';

function townInRegion(region: number): Town | undefined {
  return worldOverlay().towns.find((t) => t.region === region);
}

/** 場所のハッシュで決まる、今までの「よく出る敵」。 */
function hashedFavored(tier: Tier, region: number): MonsterDef | undefined {
  const pool = randomPool(tier);
  if (pool.length === 0) return undefined;
  const a = regionAffinity(region);
  return pool[((a % pool.length) + pool.length) % pool.length];
}

/** データで決めた町のテーマ (無ければ undefined)。 */
export function townThemeOverride(town: Pick<Town, 'x' | 'y'>): Element | undefined {
  return shopOverrideAt(town.x, town.y)?.theme;
}

/** 地方の「よく出る敵」。町のテーマ (と上書き) があればそれに合わせる。 */
export function regionFavoredMonster(tier: Tier, region: number): MonsterDef | undefined {
  const town = townInRegion(region);
  const over = town ? shopOverrideAt(town.x, town.y) : undefined;
  const pool = randomPool(tier);
  const usable = (m: MonsterDef) => (m.spawnWeight ?? 1) >= 1;
  const pinned = over?.favoredMonsterId ? pool.find((m) => m.id === over.favoredMonsterId && usable(m)) : undefined;
  if (pinned) return pinned;
  const themed = over?.theme ? pool.find((m) => usable(m) && monsterStoneElement(m) === over.theme) : undefined;
  return themed ?? hashedFavored(tier, region);
}

/**
 * 遭遇と「よく出る敵」の表示に渡す相性の値 (`summonMonster` / `favoredMonsterFor` の affinity)。
 * その tier のプールで `regionFavoredMonster` の位置を返すので、`favoredMonsterFor(tier, この値)` は同じ敵になる。
 */
export function regionFavorAffinity(tier: Tier, region: number): number {
  const fav = regionFavoredMonster(tier, region);
  const i = fav ? randomPool(tier).indexOf(fav) : -1;
  return i >= 0 ? i : regionAffinity(region);
}

/** 町のテーマの属性 (店の値札・魔石の交換で使う魔石)。データが無ければ、その地方のよく出る敵の属性。 */
export function townTheme(town: Pick<Town, 'x' | 'y' | 'region'>, tier: Tier): Element {
  const over = townThemeOverride(town);
  if (over) return over;
  const fav = regionFavoredMonster(tier, town.region);
  return fav ? monsterStoneElement(fav) : 'void';
}

/** その町の魔石の交換 (品と町の魔石の数)。データが無ければ空。 */
export function townExchange(town: Pick<Town, 'x' | 'y' | 'region'>, tier: Tier): { stoneId: string; entries: ShopExchangeEntry[] } {
  return { stoneId: STONE_IDS[townTheme(town, tier)], entries: (shopOverrideAt(town.x, town.y)?.exchange ?? []).map((e) => ({ ...e })) };
}
