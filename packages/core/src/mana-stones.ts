/**
 * **属性の魔石** (D-MATERIAL-001)。素材は地・水・火・風・空の 5 種の魔石だけ。きまりはこのファイル 1 か所に置き、
 * edge (報酬・店・ひきとり)、web (店の表示)、管理画面 (敵の魔石の数)、sim が同じ関数を使う。
 *
 * - 落とす数: 1 + floor(想定Lv / 10)。ボス (patternSets がある敵) は +2、めずらしい敵 (spawnWeight < 1) は 3 倍。
 *   敵のデータに整数の `stones` があればそれを使う。属性の無い敵は空の魔石。
 * - うん・巫女の直感: 1 体ごとに「+1 個」の確率 (min(0.95, うん × dropLukScale + 直感))。
 * - 値札 (`price.materials` はデータに魔石の個数で書く): 属性つきの装備は 3 分の 1 (切り上げ) をその属性の魔石、
 *   残りを町のテーマの魔石。町のテーマと同じ属性なら全部その属性。属性の無い品は全部町の魔石。
 * - ひきとり: 魔石 15 個でパワー 1 (SALE_TUNING)。負けたとき: なくす 1 回ぶんが魔石なら 3 個 (`lossStonesPerPick`)。
 */
import type { Element } from './elements.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { createRng } from './battle-rng.js';
import { MONSTERS_BY_ID, TIER_LEVEL, type MonsterDef } from './battle-monsters.js';

/** 属性ごとの魔石の id (ITEMS のキー)。 */
export const STONE_IDS: Readonly<Record<Element, string>> = {
  earth: 'stone-earth',
  water: 'stone-water',
  fire: 'stone-fire',
  wind: 'stone-wind',
  void: 'stone-void',
};

/** 魔石の名前。どうぐのレコードに無くても、この名前で ITEMS に入る (item-data が足す)。 */
export const STONE_NAMES: Readonly<Record<Element, string>> = {
  earth: '地の魔石',
  water: '水の魔石',
  fire: '火の魔石',
  wind: '風の魔石',
  void: '空の魔石',
};

const STONE_ELEMENTS: readonly Element[] = ['earth', 'water', 'fire', 'wind', 'void'];
const ELEMENT_BY_STONE: Readonly<Record<string, Element>> = Object.fromEntries(STONE_ELEMENTS.map((e) => [STONE_IDS[e], e]));

/** 魔石の数のきまり (整数だけ)。 */
export const STONE_RULES = {
  /** 想定Lv をこの数で割った商 (切り捨て) を 1 に足す。 */
  levelStep: 10,
  /** ボス (patternSets がある敵) に足す数。 */
  bossBonus: 2,
  /** めずらしい敵 (spawnWeight < 1) に掛ける数。 */
  rareMultiplier: 3,
  /** 「+1 個」の確率の上限。 */
  extraChanceMax: 0.95,
  /** 値札のうち、装備の属性の魔石で払う割合の分母 (3 なら 3 分の 1、切り上げ)。 */
  elementShareDivisor: 3,
  /** 負けたとき、なくす 1 回ぶんが魔石だったら、この数だけなくす (旧素材 1 個 = 魔石 3 個の値打ち)。 */
  lossStonesPerPick: 3,
} as const;

/** 魔石の id か。 */
export function isStoneId(id: string): boolean {
  return id in ELEMENT_BY_STONE;
}

/** 魔石の id → 属性 (魔石でなければ undefined)。 */
export function stoneElementOf(id: string): Element | undefined {
  return ELEMENT_BY_STONE[id];
}

/** 全部の魔石の id (地・水・火・風・空の順)。 */
export function allStoneIds(): string[] {
  return STONE_ELEMENTS.map((e) => STONE_IDS[e]);
}

/** その敵が落とす魔石の属性 (属性の無い敵は空)。 */
export function monsterStoneElement(m: Pick<MonsterDef, 'element'>): Element {
  return m.element ?? 'void';
}

/** 式で決まる魔石の数 (データの上書き `stones` を見ない。管理画面で「式の値」として出す)。 */
export function formulaStonesFor(m: Pick<MonsterDef, 'level' | 'tier' | 'patternSets' | 'spawnWeight'>): number {
  const level = m.level ?? TIER_LEVEL[m.tier];
  let n = 1 + Math.floor(level / STONE_RULES.levelStep) + (m.patternSets ? STONE_RULES.bossBonus : 0);
  if ((m.spawnWeight ?? 1) < 1) n *= STONE_RULES.rareMultiplier;
  return n;
}

/** その敵 1 体が必ず落とす魔石の数 (上書き `stones` があればそれ)。 */
export function stonesFor(m: Pick<MonsterDef, 'level' | 'tier' | 'patternSets' | 'spawnWeight' | 'stones'>): number {
  return m.stones ?? formulaStonesFor(m);
}

/** 勝ったときの魔石 (1 体ぶん)。決定的。dropBonus = 巫女の直感。 */
export function rollStoneDrops(monsterId: string, luk: number, seed: number, dropBonus = 0): string[] {
  const def = MONSTERS_BY_ID[monsterId];
  if (!def) return [];
  const rng = createRng((seed ^ 0x6a09e667) >>> 0);
  const extra = rng() < Math.min(STONE_RULES.extraChanceMax, luk * BATTLE_TUNING.dropLukScale + dropBonus) ? 1 : 0;
  return Array.from({ length: stonesFor(def) + extra }, () => STONE_IDS[monsterStoneElement(def)]);
}

/** 値札の魔石 (魔石の id → 個数)。`count` はデータの `price.materials` (魔石の個数)。 */
export function stonePrice(count: number, theme: Element, element?: Element): Record<string, number> {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return {};
  if (!element || element === theme) return { [STONE_IDS[theme]]: n };
  const own = Math.ceil(n / STONE_RULES.elementShareDivisor);
  return { [STONE_IDS[element]]: own, ...(n - own > 0 ? { [STONE_IDS[theme]]: n - own } : {}) };
}

/** 手持ちで払えるか。 */
export function canPayStones(materials: Readonly<Record<string, number>>, price: Readonly<Record<string, number>>): boolean {
  return Object.entries(price).every(([id, n]) => (materials[id] ?? 0) >= n);
}

/** 払ったあとの手持ち (0 になった品は消す)。払えないときは呼ばない (canPayStones で確かめる)。 */
export function payStones(materials: Readonly<Record<string, number>>, price: Readonly<Record<string, number>>): Record<string, number> {
  const out = { ...materials };
  for (const [id, n] of Object.entries(price)) {
    const left = (out[id] ?? 0) - n;
    if (left > 0) out[id] = left;
    else delete out[id];
  }
  return out;
}

/** 魔石になる前の素材の id (D-MATERIAL-001)。持ち物に残っていても読むときに捨てる (dev は誰も遊んでいない)。 */
export const LEGACY_MATERIAL_IDS: readonly string[] = [
  'slime-drop', 'red-jelly', 'metal-shard', 'bat-wing', 'mush-spore', 'golem-core',
  'wisp-ember', 'serpent-scale', 'raven-feather', 'oni-horn', 'dragon-fang',
];

/** 持ち物から旧素材を除く (無ければ同じ参照を返す)。 */
export function withoutLegacyMaterials(materials: Readonly<Record<string, number>>): Record<string, number> {
  if (!LEGACY_MATERIAL_IDS.some((id) => id in materials)) return materials as Record<string, number>;
  const out = { ...materials };
  for (const id of LEGACY_MATERIAL_IDS) delete out[id];
  return out;
}
