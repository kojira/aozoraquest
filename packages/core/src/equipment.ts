/**
 * 装備品となんでも屋の品揃え (docs/20-shop-equipment.md, W6a)。
 *
 * 設計 (オーナー決定 2026-07-17〜18):
 * - **4 層**: 共用 (誰でも) → 系統カテゴリ品 (装備適性マトリクス) →
 *   ジョブ専用・中位 → ジョブ専用・上位 (特色枠)。
 * - **装備適性はカテゴリ × ジョブのマトリクス** (JOB_EQUIP_KINDS)。戦士は
 *   「MP が低い代わりにほとんどの武器・防具を装備できる」— 適性の広さが
 *   MP 特性 (JOB_MP_TRAITS) の裏返しの職特性になる。
 * - **ジョブ専用品 (jobOnly) はマトリクス不問** — 自ジョブなら装備できる
 *   (神楽鈴に鈴カテゴリは要らない)。
 * - 効果はブレンド・レベル補正の**後に平坦加算** (playerCombatant/playerStatsAt)。
 * - 品揃えは (危険度, 街ハッシュ) から決定的に生成 (townShopInventory)。
 */

import type { Archetype } from './types.js';
import type { Town } from './world.js';

/** mulberry32 (battle.ts の createRng と同型)。battle → equipment の import を
 *  可能にするため循環を避けてローカルに持つ。 */
function shopRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type EquipSlot = 'weapon' | 'armor' | 'charm';

/** 装備カテゴリ。common/cloth/charm は全ジョブ暗黙 ○。 */
export type EquipKind =
  | 'common' // 共用武器 (ナイフ等)
  | 'sword'
  | 'axe'
  | 'shield'
  | 'dagger'
  | 'staff'
  | 'lucky' // 運具 (ダイス・タリスマン)
  | 'heavy' // 重装
  | 'light' // 軽装
  | 'robe'
  | 'cloth' // 共用衣 (誰でも)
  | 'charm';

export interface EquipmentDef {
  id: string;
  name: string;
  slot: EquipSlot;
  kind: EquipKind;
  /** ステータス加算 (ブレンド・レベル補正の後に平坦加算)。 */
  bonus: Partial<Record<'atk' | 'def' | 'agi' | 'int' | 'luk' | 'maxHp', number>>;
  /** 1 職専用 (指定があればカテゴリ不問でそのジョブのみ装備可)。 */
  jobOnly?: Archetype;
  /** 品揃え生成の階級。1=初級 2=中位 3=上位 (特色枠)。 */
  grade: 1 | 2 | 3;
  /** 値札: あおぞらパワー + 素材個数 (素材の種類は店側が地域ドロップから決める)。 */
  price: { power: number; materials: number };
}

/** 装備適性マトリクス (オーナー承認 2026-07-18)。common/cloth/charm は暗黙 ○。 */
export const JOB_EQUIP_KINDS: Record<Archetype, readonly EquipKind[]> = {
  warrior: ['sword', 'axe', 'shield', 'dagger', 'heavy', 'light'], // 杖と運具以外ぜんぶ
  guardian: ['sword', 'axe', 'shield', 'heavy'],
  shogun: ['sword', 'axe', 'dagger', 'heavy', 'light'],
  captain: ['sword', 'axe', 'shield', 'dagger', 'heavy', 'light'],
  ninja: ['sword', 'dagger', 'light'],
  performer: ['sword', 'dagger', 'lucky', 'light'],
  sage: ['dagger', 'staff', 'robe'],
  mage: ['dagger', 'staff', 'robe'],
  seer: ['staff', 'lucky', 'robe'],
  fighter: ['sword', 'axe', 'dagger', 'staff', 'light'],
  bard: ['dagger', 'lucky', 'light'],
  poet: ['dagger', 'lucky', 'robe'],
  paladin: ['sword', 'shield', 'staff', 'lucky', 'heavy'],
  explorer: ['sword', 'axe', 'dagger', 'lucky', 'light'],
  artist: ['dagger', 'lucky', 'light', 'robe'],
  miko: ['staff', 'lucky', 'robe'],
};

/** ジョブ専用武器 (中位 +8 / 上位 +14)。効果は支配ステータス。 */
const JOB_WEAPONS: Array<{ job: Archetype; stat: 'atk' | 'def' | 'agi' | 'int' | 'luk'; mid: string; high: string }> = [
  { job: 'sage', stat: 'int', mid: '賢者の杖', high: '天啓の錫杖' },
  { job: 'mage', stat: 'int', mid: '魔法の杖', high: '星読みの大杖' },
  { job: 'shogun', stat: 'atk', mid: '将軍の采配', high: '軍神の大太刀' },
  { job: 'bard', stat: 'luk', mid: '竪琴', high: '月夜の琴' },
  { job: 'seer', stat: 'int', mid: '占いの水晶', high: '水晶の宝珠' },
  { job: 'poet', stat: 'luk', mid: '詩人のペン', high: '心晴の筆' },
  { job: 'paladin', stat: 'luk', mid: '騎士の盾', high: '聖印のロザリオ' },
  { job: 'explorer', stat: 'luk', mid: '旅のコンパス', high: '風来のコンパス' },
  { job: 'warrior', stat: 'def', mid: '戦士の剣', high: 'まもりの剛剣' },
  { job: 'guardian', stat: 'def', mid: '守護者の大盾', high: '城壁の大盾' },
  { job: 'fighter', stat: 'int', mid: 'からくり工具', high: 'からくり万能腕' },
  { job: 'artist', stat: 'luk', mid: '絵筆', high: '虹彩のパレット' },
  { job: 'captain', stat: 'atk', mid: '隊長の軍刀', high: '突撃の軍旗' },
  { job: 'miko', stat: 'luk', mid: '神楽鈴', high: '大神楽の鈴' },
  { job: 'ninja', stat: 'agi', mid: '忍者刀', high: '影縫いの手裏剣' },
  { job: 'performer', stat: 'agi', mid: '曲芸のナイフ', high: '曲芸の舞扇' },
];

export const EQUIPMENT: EquipmentDef[] = [
  // ─── 共用武器 (誰でも) ───
  { id: 'wp-knife', name: 'ナイフ', slot: 'weapon', kind: 'common', bonus: { atk: 2 }, grade: 1, price: { power: 4, materials: 1 } },
  { id: 'wp-club', name: 'こんぼう', slot: 'weapon', kind: 'common', bonus: { atk: 4 }, grade: 1, price: { power: 8, materials: 2 } },
  { id: 'wp-travel-sword', name: 'たびのつるぎ', slot: 'weapon', kind: 'common', bonus: { atk: 7 }, grade: 2, price: { power: 14, materials: 3 } },
  // ─── 系統カテゴリ武器 (初級 +4、意匠なしの汎用) ───
  { id: 'wp-axe', name: '戦斧', slot: 'weapon', kind: 'axe', bonus: { atk: 4 }, grade: 1, price: { power: 10, materials: 2 } },
  { id: 'wp-iron-shield', name: '鉄の盾', slot: 'weapon', kind: 'shield', bonus: { def: 4 }, grade: 1, price: { power: 10, materials: 2 } },
  { id: 'wp-swift-dagger', name: '疾風の短刀', slot: 'weapon', kind: 'dagger', bonus: { agi: 4 }, grade: 1, price: { power: 10, materials: 2 } },
  { id: 'wp-novice-staff', name: '見習いの杖', slot: 'weapon', kind: 'staff', bonus: { int: 4 }, grade: 1, price: { power: 10, materials: 2 } },
  { id: 'wp-lucky-dice', name: '幸運のダイス', slot: 'weapon', kind: 'lucky', bonus: { luk: 4 }, grade: 1, price: { power: 10, materials: 2 } },
  // ─── ジョブ専用武器 (中位 +8 / 上位 +14) — 生成 ───
  ...JOB_WEAPONS.flatMap<EquipmentDef>((w) => [
    {
      id: `wp-${w.job}-mid`,
      name: w.mid,
      slot: 'weapon',
      kind: 'common', // jobOnly が判定の全て (カテゴリ不問 — オーナー決定 2026-07-18)
      bonus: { [w.stat]: 8 },
      jobOnly: w.job,
      grade: 2,
      price: { power: 20, materials: 4 },
    },
    {
      id: `wp-${w.job}-high`,
      name: w.high,
      slot: 'weapon',
      kind: 'common',
      bonus: { [w.stat]: 14 },
      jobOnly: w.job,
      grade: 3,
      price: { power: 40, materials: 6 },
    },
  ]),
  // ─── 防具 ───
  { id: 'ar-cloth', name: 'ぬののふく', slot: 'armor', kind: 'cloth', bonus: { def: 2 }, grade: 1, price: { power: 4, materials: 1 } },
  { id: 'ar-leather', name: 'かわのよろい', slot: 'armor', kind: 'cloth', bonus: { def: 4 }, grade: 1, price: { power: 8, materials: 2 } },
  { id: 'ar-travel-cloak', name: 'たびのマント', slot: 'armor', kind: 'cloth', bonus: { def: 6 }, grade: 2, price: { power: 14, materials: 3 } },
  { id: 'ar-iron', name: '鉄のよろい', slot: 'armor', kind: 'heavy', bonus: { def: 8 }, grade: 2, price: { power: 20, materials: 4 } },
  { id: 'ar-nimble', name: 'かるわざの衣', slot: 'armor', kind: 'light', bonus: { def: 4, agi: 3 }, grade: 2, price: { power: 20, materials: 4 } },
  { id: 'ar-scholar', name: 'まなびのローブ', slot: 'armor', kind: 'robe', bonus: { def: 4, int: 3 }, grade: 2, price: { power: 20, materials: 4 } },
  { id: 'ar-fortune', name: 'しあわせの衣', slot: 'armor', kind: 'light', bonus: { def: 4, luk: 3 }, grade: 2, price: { power: 20, materials: 4 } },
  // ─── お守り (W6a はステータス系のみ。挙動系 (回避/にげる/ドロップ/MP減) は
  //     戦闘エンジンへのフック実装とセットで後続 PR — 効かない品は店に出さない) ───
  { id: 'ch-life', name: 'いのちのペンダント', slot: 'charm', kind: 'charm', bonus: { maxHp: 10 }, grade: 2, price: { power: 16, materials: 3 } },
  { id: 'ch-traveler', name: 'たびびとのおまもり', slot: 'charm', kind: 'charm', bonus: { def: 2 }, grade: 1, price: { power: 6, materials: 1 } },
];

export const EQUIPMENT_BY_ID: Record<string, EquipmentDef> = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e]));

/** 装備できるか。jobOnly があればそれだけで判定 (カテゴリ不問)。 */
export function canEquip(archetype: Archetype, def: EquipmentDef): boolean {
  if (def.jobOnly) return def.jobOnly === archetype;
  if (def.kind === 'common' || def.kind === 'cloth' || def.kind === 'charm') return true;
  return JOB_EQUIP_KINDS[archetype].includes(def.kind);
}

export interface GearBonus {
  atk: number;
  def: number;
  agi: number;
  int: number;
  luk: number;
  maxHp: number;
}

/** 装備 (id 列) の合計ボーナス。未知 id と装備不可の品は無視 (壊れたレコード耐性)。 */
export function gearBonus(archetype: Archetype, equipIds: readonly string[]): GearBonus {
  const total: GearBonus = { atk: 0, def: 0, agi: 0, int: 0, luk: 0, maxHp: 0 };
  for (const id of equipIds) {
    const def = EQUIPMENT_BY_ID[id];
    if (!def || !canEquip(archetype, def)) continue;
    for (const [k, v] of Object.entries(def.bonus)) {
      total[k as keyof GearBonus] += v ?? 0;
    }
  }
  return total;
}

// ─── なんでも屋の品揃え (決定的生成) ────────────────────────

export interface ShopStock {
  /** 消耗品 (ITEMS の id) */
  consumables: string[];
  /** 装備 (EQUIPMENT の id)。特色枠のジョブ専用品を含む */
  equipment: string[];
}

/**
 * 街の品揃えを決定的に生成する (docs/20)。
 * 1. 基本枠: やくそう / そらのしずく / そらのはね (+danger2 以上で いやしのしずく ※未実装のため W6b で)
 * 2. 地域枠: danger に応じた階級の汎用装備
 * 3. 特色枠: 街ハッシュで決まるジョブ専用品 1〜2 品 (どの街が何のジョブの品を
 *    持つかが地図を見る動機になる)
 */
/**
 * townIndex: worldOverlay().towns 配列内の位置。特色枠のジョブ割当を巡回にして
 * **全 16 職の専用品が世界のどこかの店に必ず並ぶ**ことを保証する
 * (純ランダムだと 53 店でも欠けるジョブが出うる)。
 */
export function townShopStock(town: Town, townIndex: number): ShopStock {
  const rng = shopRng(((town.x * 73856093) ^ (town.y * 19349663)) >>> 0);
  const consumables = ['herb', 'sky-dew', 'sky-feather'];

  const equipment: string[] = [];
  // 地域枠: 共用 + カテゴリ品から 3〜4 品 (grade1 中心、たまに grade2)
  const generic = EQUIPMENT.filter((e) => !e.jobOnly && e.slot !== 'charm' && e.grade <= 2);
  const genericCount = 3 + Math.floor(rng() * 2);
  const pool = [...generic];
  for (let i = 0; i < genericCount && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    equipment.push(pool[idx]!.id);
    pool.splice(idx, 1);
  }
  // お守り (低確率で 1 品)
  const charms = EQUIPMENT.filter((e) => e.slot === 'charm');
  if (rng() < 0.4 && charms.length > 0) {
    equipment.push(charms[Math.floor(rng() * charms.length)]!.id);
  }
  // 特色枠: ジョブ専用・中位は town index の巡回割当 (互いに素な歩幅 7 で分散)、
  // 上位はハッシュ乱択で 50% (「あの街にしかない」レア枠)
  const jobMid = EQUIPMENT.filter((e) => e.jobOnly && e.grade === 2);
  const jobHigh = EQUIPMENT.filter((e) => e.jobOnly && e.grade === 3);
  equipment.push(jobMid[(townIndex * 7) % jobMid.length]!.id);
  if (rng() < 0.5 && jobHigh.length > 0) {
    equipment.push(jobHigh[Math.floor(rng() * jobHigh.length)]!.id);
  }

  return { consumables, equipment };
}
