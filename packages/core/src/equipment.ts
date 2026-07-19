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
 * - 品揃えは決定的に生成 (townShopStock)。W6a 時点は「街ハッシュ + 巡回割当」のみ —
 *   danger 階級・周辺地形の系統枠 (docs/20) は W6b で追加する。
 */

import type { Archetype } from './types.js';
import { regionDanger, tierForDanger } from './world.js';
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
  | 'exclusive' // ジョブ専用品 (jobOnly が判定の全て。カテゴリ表示にも使わない)
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

/** ジョブ専用武器 (中位 +8 / 上位 +14)。効果は原則支配ステータスだが、職の
 *  構造的弱点は bonusMid/bonusHigh の複合効果で補完できる (将軍: 支配ステの
 *  こうげきを盛っても弱点の耐久が埋まらず、フル装備でも tier3 45% と唯一
 *  破綻していた — 采配/大太刀に「兵が守る」耐久を付けて 65% に。sim 実測)。 */
const JOB_WEAPONS: Array<{
  job: Archetype;
  stat: 'atk' | 'def' | 'agi' | 'int' | 'luk';
  mid: string;
  high: string;
  bonusMid?: EquipmentDef['bonus'];
  bonusHigh?: EquipmentDef['bonus'];
}> = [
  { job: 'sage', stat: 'int', mid: '賢者の杖', high: '天啓の錫杖' },
  { job: 'mage', stat: 'int', mid: '魔法の杖', high: '星読みの大杖' },
  {
    job: 'shogun',
    stat: 'atk',
    mid: '将軍の采配',
    high: '軍神の大太刀',
    // 指揮官は兵に守られる: 弱点の耐久を装備で補完 (オーナー指摘 2026-07-18
    // 「将軍アイテム手に入れてもよわくない?」への対応)
    bonusMid: { atk: 6, def: 4, maxHp: 6 },
    bonusHigh: { atk: 10, def: 7, maxHp: 14 },
  },
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
      kind: 'exclusive', // jobOnly が判定の全て (カテゴリ不問 — オーナー決定 2026-07-18)
      bonus: w.bonusMid ?? { [w.stat]: 8 },
      jobOnly: w.job,
      grade: 2,
      price: { power: 20, materials: 4 },
    },
    {
      id: `wp-${w.job}-high`,
      name: w.high,
      slot: 'weapon',
      kind: 'exclusive',
      bonus: w.bonusHigh ?? { [w.stat]: 14 },
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
  if (def.kind === 'exclusive') return false; // jobOnly の付け忘れは安全側 (誰も装備不可)
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

// ─── 素材のひきとり (素材 → パワー変換) ─────────────────────

/** ひきとりチューニング (オーナー決定 2026-07-18「素材を燃やしてあおぞらパワーに
 *  変換する仕組みも必要。無限ループ防止のためレートは低め」)。
 *  レート根拠: 1 戦 = パワー 1 に対し**売却可能素材** (消耗品除く) の期待値は
 *  最大 ~0.7 個 (luk 上振れ cap 0.95) → 5:1 なら回収 ≤0.19 パワーの強い赤字 =
 *  戦闘→換金ループは成立しない (テストで cap 基準の最悪値を固定)。 */
export const SALE_TUNING = {
  /** この個数の素材 = パワー 1 */
  materialsPerPower: 5,
} as const;

/** 消耗品 (ひきとり対象外 — それぞれ固有の使い道がある)。 */
export const CONSUMABLE_ITEMS: readonly string[] = ['herb', 'sky-dew', 'sky-feather'];

/** ひきとり対象 (モンスター素材のみ)。battle.ts の MONSTERS drops と同期
 *  (equipment→battle は循環になるため静的リスト。整合はテストで固定)。 */
export const SELLABLE_MATERIALS: readonly string[] = [
  'slime-drop',
  'red-jelly',
  'metal-shard',
  'bat-wing',
  'dusk-wing',
  'mush-spore',
  'crimson-spore',
  'golem-core',
  'wisp-ember',
  'serpent-scale',
  'raven-feather',
  'oni-horn',
  'dragon-fang',
];

export function isSellableMaterial(id: string): boolean {
  return SELLABLE_MATERIALS.includes(id);
}

/** count 個ひきとってもらったときのパワー (端数は切り捨て — 5 個未満は 0)。 */
export function salePowerFor(count: number): number {
  return Math.floor(Math.max(0, count) / SALE_TUNING.materialsPerPower);
}

// ─── 制作 (クラフト) と品質 ─────────────────────────────────

/** 強化値チューニング (docs/20。オーナー決定 2026-07-18: 品質は −1〜+10、
 *  +6 以上は同アイテム同値 2 つの合成のみ = 過剰なアイテムを燃やすシンク)。 */
export const CRAFT_TUNING = {
  /** 制作ロールの範囲。+6 以上は合成 (forge) でしか作れない */
  craftMin: -1,
  craftMax: 5,
  /** 強化値の絶対上限 */
  levelMax: 10,
  /** 制作ロールの下限 = floor(luk × lukFloorScale) (上限 lukFloorMax)。
   *  「うんが高いほど下振れしにくい」— gamble・敗北ドロップと同じ設計言語。
   *  luk 20 で −1 (失敗作) を引かなくなり、luk 40 で +2 が底になる */
  lukFloorScale: 0.05,
  lukFloorMax: 3,
  /** 「名匠の」を名乗れる強化値 (制作で出る最高値) */
  masterworkLevel: 5,
} as const;

/** craft レコードの rkey (文字列) を決定的に u32 seed へ (FNV-1a)。 */
export function craftSeedFromRkey(rkey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < rkey.length; i++) {
    h ^= rkey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 制作ロールの強化値 (−1〜+5)。seed から決定的 — craft レコードの rkey と制作時
 * luk があれば誰でも再計算できる (自己申告フィールドを持たない = 正規クライアント
 * 間の整合性保証。rkey はクライアント選択のため総当たりへの耐性は無い — 改竄の
 * 最終防衛は W3 のサーバー権威)。
 * 分布は低い値ほど出やすい重み付き。luk が下限を引き上げる (失敗作 −1 を回避)。
 */
export function craftLevelRoll(seed: number, luk: number): number {
  const t = CRAFT_TUNING;
  // 重み: -1:14, 0:22, +1:22, +2:16, +3:12, +4:9, +5:5 (計 100)
  const weights: Array<[number, number]> = [[-1, 14], [0, 22], [1, 22], [2, 16], [3, 12], [4, 9], [5, 5]];
  const floor = Math.min(t.lukFloorMax, Math.floor(Math.max(0, luk) * t.lukFloorScale));
  const usable = weights.filter(([lv]) => lv >= Math.min(floor, t.craftMax) || lv === t.craftMax);
  const pool = usable.length > 0 ? usable : weights;
  const total = pool.reduce((a, [, w]) => a + w, 0);
  let r = shopRng((seed ^ 0x3c6ef372) >>> 0)() * total;
  for (const [lv, w] of pool) {
    r -= w;
    if (r < 0) return lv;
  }
  return pool[pool.length - 1]![0];
}

/** 強化値を適用した装備ボーナス: 主効果 (最大のボーナス) に +level (最低 1 は保証)。 */
export function bonusWithLevel(def: EquipmentDef, level: number): EquipmentDef['bonus'] {
  const lv = Math.max(CRAFT_TUNING.craftMin, Math.min(CRAFT_TUNING.levelMax, Math.round(level)));
  const entries = Object.entries(def.bonus).filter(([, v]) => v !== undefined) as Array<[string, number]>;
  if (entries.length === 0 || lv === 0) return { ...def.bonus };
  let primary = entries[0]!;
  for (const e of entries) if (e[1] > primary[1]) primary = e;
  const out: EquipmentDef['bonus'] = { ...def.bonus };
  out[primary[0] as keyof EquipmentDef['bonus']] = Math.max(1, primary[1] + lv);
  return out;
}

/** 合成 (きたえる): 同じアイテム・同じ強化値 2 つ → +1。+6 以上への唯一の道。 */
export function canForge(level: number): boolean {
  return level < CRAFT_TUNING.levelMax;
}
export function forgedLevel(level: number): number {
  return Math.min(CRAFT_TUNING.levelMax, level + 1);
}

/** 名匠品か (+5 = 制作で出る最高値。合成でそれ以上もある)。 */
export function isMasterwork(level: number): boolean {
  return level >= CRAFT_TUNING.masterworkLevel;
}

/** 表示名: 「ナイフ+3」「ナイフ-1」。±0 は素の名前。 */
export function leveledName(def: EquipmentDef, level: number): string {
  if (level === 0) return def.name;
  return `${def.name}${level > 0 ? `+${level}` : `${level}`}`;
}

/** 装備中の個体。level 省略時は定義値そのまま (±0 相当)。
 *  **契約 (W6c)**: gear/self レコードには level を直書きせず craft/forge レコードの
 *  rkey を参照し、集計 (loadCraftInventory) が再導出した level をここへ渡すこと。
 *  level はあくまで導出済みの表示・計算用で、レコード上の自己申告値ではない
 *  (レビュー指摘: 直書きを信用すると偽造耐性の建前が崩れる)。 */
export interface GearPiece {
  id: string;
  level?: number;
}

export interface GearSelection {
  weapon?: GearPiece | string;
  armor?: GearPiece | string;
  charm?: GearPiece | string;
}

/**
 * gear/self レコード形式 ({weapon?, armor?, charm?}) からのボーナス合算。
 * **スロットと装備の slot が一致する品だけ**数える (weapon 枠に武器以外を書く・
 * 同じ強武器を 3 枠に書く、といったレコード直編集チートを弾く。W6c の正式入口)。
 */
export function gearBonusFromGear(archetype: Archetype, gear: GearSelection): GearBonus {
  const total: GearBonus = { atk: 0, def: 0, agi: 0, int: 0, luk: 0, maxHp: 0 };
  for (const slot of ['weapon', 'armor', 'charm'] as const) {
    const piece = gear[slot];
    if (!piece) continue;
    const id = typeof piece === 'string' ? piece : piece.id;
    const rawLevel = typeof piece === 'string' ? undefined : piece.level;
    // 非数値 (レコード直編集で JSON 文字列等) は NaN が全ステータスへ伝播するため
    // 定義値フォールバック (レビュー実測指摘)
    const level = typeof rawLevel === 'number' && Number.isFinite(rawLevel) ? rawLevel : undefined;
    const def = EQUIPMENT_BY_ID[id];
    if (!def || def.slot !== slot || !canEquip(archetype, def)) continue;
    const bonus = level !== undefined ? bonusWithLevel(def, level) : def.bonus;
    for (const [k, v] of Object.entries(bonus)) {
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
  /** この店の値札で要求される素材の種類 (price.materials の個数分)。
   *  地域のモンスター素材から決定的に選ぶ — 「その地域で狩って買う」ループ */
  materialId: string;
}

/** 店が値札に使う素材の種類 (街ハッシュから決定的)。**その街の危険度で狩れる
 *  モンスターの素材から選ぶ** — 初版は全素材からのハッシュ乱択で、低危険度の
 *  街 23 件中 11 件が周辺で狩れない tier2 素材を要求し「素材が必要だから装備まで
 *  たどり着けない」詰みを作っていた (オーナー報告 2026-07-18)。
 *  danger→tier の対応は tierForDanger (遭遇と同じ単一の正)。
 *  素材 id は battle.ts の MONSTERS ドロップ表の直書き複製 — battle → equipment の
 *  既存依存があり MONSTERS から derive すると循環するため。テスト (equipment.test)
 *  が全街ぶんドロップ表と突き合わせて同期を保証する。 */
const SHOP_MATERIALS_BY_TIER: readonly [readonly string[], readonly string[], readonly string[]] = [
  ['slime-drop', 'bat-wing', 'mush-spore'], // tier1 (danger 0-1)
  ['golem-core', 'wisp-ember', 'serpent-scale'], // tier2 (danger 2)
  ['raven-feather', 'oni-horn', 'dragon-fang'], // tier3 (danger 3)
];
export function shopMaterialFor(town: Town): string {
  const tier = tierForDanger(regionDanger(town.region));
  const pool = tier === 1 ? SHOP_MATERIALS_BY_TIER[0] : tier === 2 ? SHOP_MATERIALS_BY_TIER[1] : SHOP_MATERIALS_BY_TIER[2];
  const rng = shopRng(((town.x * 40503) ^ (town.y * 89917)) >>> 0);
  return pool[Math.floor(rng() * pool.length)]!;
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
  // 特色枠: ジョブ専用・中位は town index の巡回割当 (互いに素な歩幅 7 で分散)。
  // 上位は 1/3 の街だけが持つレア枠だが、こちらも巡回 (歩幅 11) で **全 16 職の
  // 上位品が世界のどこかに必ず並ぶ** (初版のハッシュ乱択は sage/mage/guardian の
  // 上位が全店欠品する恒久欠けを起こした — レビュー実測)
  const jobMid = EQUIPMENT.filter((e) => e.jobOnly && e.grade === 2);
  const jobHigh = EQUIPMENT.filter((e) => e.jobOnly && e.grade === 3);
  equipment.push(jobMid[(townIndex * 7) % jobMid.length]!.id);
  if (townIndex % 3 === 0 && jobHigh.length > 0) {
    equipment.push(jobHigh[(Math.floor(townIndex / 3) * 11) % jobHigh.length]!.id);
  }

  return { consumables, equipment, materialId: shopMaterialFor(town) };
}
