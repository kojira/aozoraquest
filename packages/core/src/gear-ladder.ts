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
  /** 想定のプレイヤー Lv (= TIER_LEVEL)。 */
  level: number;
}

export const GEAR_LADDER: Record<GearGrade, GearLadderStep> = {
  1: { weaponAtk: 4, armorTotal: 6, enemy: { atk: 6, def: 6, hp: 11 }, level: 1 },
  2: { weaponAtk: 12, armorTotal: 22, enemy: { atk: 17, def: 28, hp: 32 }, level: 4 },
  3: { weaponAtk: 24, armorTotal: 45, enemy: { atk: 31, def: 47, hp: 54 }, level: 8 },
  4: { weaponAtk: 41, armorTotal: 77, enemy: { atk: 48, def: 72, hp: 71 }, level: 13 },
  5: { weaponAtk: 70, armorTotal: 138, enemy: { atk: 82, def: 109, hp: 118 }, level: 19 },
  6: { weaponAtk: 108, armorTotal: 217, enemy: { atk: 126, def: 154, hp: 183 }, level: 26 },
};

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
