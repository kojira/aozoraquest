/**
 * **装備の梯子** (D-ENDGAME-001 §A3)。grade 1〜6 の値の目安を 1 か所に置く。
 *
 * 決め方: その帯の装備で受けるダメージが最大 HP の 12〜15%、1 つ下の装備だと 40〜50%。
 * その帯の武器で帯の敵を 3.3〜4 発、1 つ下だと 6.6〜8.6 発で倒す。帯の敵の atk は
 * かすりの床 (atk × scratchRatio) より上にして、1 つ下から上げた守りが必ず効くようにする。
 * 品のデータを作るスクリプト・帯の敵の値・sim (scripts/eg-ladder.mts) はここを読む。
 */
import type { Archetype } from './types.js';
import { ARCHETYPES } from './types.js';
import { canEquip, type EquipmentDef } from './equipment.js';

/** 装備の段階。grade g の品は tier g の店から並ぶ (`maxShopGradeForTier`)。 */
export type GearGrade = 1 | 2 | 3 | 4 | 5 | 6;
export const GEAR_GRADES: readonly GearGrade[] = [1, 2, 3, 4, 5, 6];

export interface GearLadderStep {
  /** 片手武器 (共用) の atk。 */
  weaponAtk: number;
  /** 守りの合計 (胴 50%・頭 15%・足 15%・お守り 20%)。 */
  armorTotal: number;
  /** 帯の敵 4 体の中ほどの戦闘値 (atk / def / HP)。 */
  enemy: { atk: number; def: number; hp: number };
  /** 想定のプレイヤー Lv (= TIER_LEVEL。帯の敵の強さの基準。TIER_RECOMMEND の「おすすめ Lv」とは別)。 */
  level: number;
  /** 片手武器・胴の値段 (パワー) の目安。部位ごとの値段は `gearPowerPrice`。品のデータはここから書く。 */
  power: number;
}

/** D-BALANCE-002 案D: grade1 の品は ×1.5、grade2 は ×1.6 (壁を装備にする)。grade2 の値段は 16 → 8
 *  (1 日 15 投稿で、どんぐりで武器と胴、かすみで 1 式そろう)。敵は tier1 の下駄 10・tier2 の level の表。 */
export const GEAR_LADDER: Record<GearGrade, GearLadderStep> = {
  1: { weaponAtk: 6, armorTotal: 9, enemy: { atk: 11, def: 11, hp: 12 }, level: 1, power: 8 },
  2: { weaponAtk: 19, armorTotal: 35, enemy: { atk: 28, def: 49, hp: 60 }, level: 4, power: 8 },
  3: { weaponAtk: 24, armorTotal: 45, enemy: { atk: 31, def: 47, hp: 54 }, level: 8, power: 40 },
  4: { weaponAtk: 41, armorTotal: 77, enemy: { atk: 48, def: 72, hp: 71 }, level: 13, power: 70 },
  5: { weaponAtk: 70, armorTotal: 138, enemy: { atk: 82, def: 109, hp: 118 }, level: 19, power: 110 },
  6: { weaponAtk: 108, armorTotal: 217, enemy: { atk: 126, def: 154, hp: 183 }, level: 26, power: 160 },
};

/** 部位ごとの値段の比 (片手武器・胴 = 1)。grade3〜6 の品のデータはこの比で書いてある。 */
const SLOT_PRICE_RATIO: Record<EquipmentDef['slot'], number> = { weapon: 1, armor: 1, head: 0.6, feet: 0.6, charm: 0.8, shield: 0.8 };
/** ジョブ専用と両手の値段の倍率。 */
const JOB_PRICE_RATIO = 1.3;
const TWO_HAND_PRICE_RATIO = 1.4;
/** 値段がこの幅の外 (目安の 0.5 倍未満・2 倍より上) なら `gearPriceDrift` が知らせる。 */
const PRICE_DRIFT_RANGE = [0.5, 2] as const;

/** その品の値段 (パワー) の目安 = GEAR_LADDER[grade].power × 部位の比 (× ジョブ専用・両手)。 */
export function gearPowerPrice(def: Pick<EquipmentDef, 'grade' | 'slot' | 'jobOnly' | 'hands'>): number {
  const step = GEAR_LADDER[def.grade as GearGrade];
  if (!step) return 0;
  return Math.round(step.power * SLOT_PRICE_RATIO[def.slot] * (def.jobOnly ? JOB_PRICE_RATIO : 1) * (def.hands === 2 ? TWO_HAND_PRICE_RATIO : 1));
}

/** 値段が目安 (`gearPowerPrice`) から大きくずれた品。カジノの景品と、パワーで売らない品 (power 0) は見ない。
 *  管理データの書き込み (edge・管理画面) がこれで止める。読み込みでは止めない (本番の古いデータを落とさない)。 */
export function gearPriceDrift(equipment: readonly EquipmentDef[]): Array<{ id: string; power: number; target: number }> {
  const out: Array<{ id: string; power: number; target: number }> = [];
  for (const e of equipment) {
    if (e.casinoOnly || !(e.price?.power > 0)) continue;
    const target = gearPowerPrice(e);
    if (target > 0 && (e.price.power < target * PRICE_DRIFT_RANGE[0] || e.price.power > target * PRICE_DRIFT_RANGE[1])) out.push({ id: e.id, power: e.price.power, target });
  }
  return out;
}

/**
 * **tier ごとの「おすすめ」** (D-BALANCE-002 案D)。その帯の敵に楽に勝てる装備の grade と Lv。
 * 街の店とギルドの「おすすめ：○段目の装備・Lv○」(`tierRecommendLabel`) はここを読む。
 *
 * - tier1・2 は 1 人で 1 戦 85〜95% になる Lv (案D の sim)。tier3 からは D-ENDGAME-001 の目標 (4 人で 87〜91%) の Lv。
 * - **ギルドの Lv (`recruitTierLevel`) とは別もの。** あちらは「その帯の街に着いたときの Lv で、すぐ雇える」ための値
 *   (着いた Lv より上だと雇うのにパワーがかかる)。こちらは「この帯を楽に進める目安」で、着いた Lv より上でよい。
 * - GEAR_LADDER の level (= TIER_LEVEL) は帯の敵の強さの基準で、これとも別。
 */
export const TIER_RECOMMEND: Readonly<Record<GearGrade, { grade: GearGrade; level: number }>> = {
  1: { grade: 1, level: 3 },
  2: { grade: 2, level: 11 },
  3: { grade: 3, level: 8 },
  4: { grade: 4, level: 13 },
  5: { grade: 5, level: 19 },
  6: { grade: 6, level: 26 },
};

/** その帯のおすすめ (tier7 以上は 6 の値)。 */
export function tierRecommend(tier: number): { grade: GearGrade; level: number } {
  return TIER_RECOMMEND[Math.min(6, Math.max(1, Math.floor(tier))) as GearGrade];
}

/** 店とギルドに出す 1 行。 */
export function tierRecommendLabel(tier: number): string {
  const r = tierRecommend(tier);
  return `おすすめ：${r.grade}段目の装備・Lv${r.level}`;
}

/** grade ごとに、その職が装備できる武器と胴が 1 つもないところ。データを書く前の検査に使う
 *  (casinoOnly は店に並ばないので数えない)。空なら 16 職がどの grade でもそろえられる。 */
export function gearGradeGaps(
  equipment: readonly EquipmentDef[],
  grades: readonly GearGrade[] = GEAR_GRADES,
): Array<{ grade: GearGrade; job: Archetype; slot: 'weapon' | 'armor' }> {
  const gaps: Array<{ grade: GearGrade; job: Archetype; slot: 'weapon' | 'armor' }> = [];
  for (const grade of grades) {
    for (const job of ARCHETYPES) {
      for (const slot of ['weapon', 'armor'] as const) {
        if (!equipment.some((e) => e.grade === grade && e.slot === slot && !e.casinoOnly && canEquip(job, e))) gaps.push({ grade, job, slot });
      }
    }
  }
  return gaps;
}
