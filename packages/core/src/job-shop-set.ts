/**
 * **買う人の職の 1 式** (D-REVIVE-001 addendum 3)。tier2 以上の街の なんでも屋 は、買う人の職が装備できる
 * その店の grade の品を、部位ごとに 1 つずつ足す (武器・盾・頭・胴・足・お守り)。
 *
 * もとは tier4 以上で「その職の専用武器」1 つだけ (JOB_SLOT_MIN_TIER)。tier2 に入ったばかりの店
 * (きつつき・どんぐり・かすみ など) には g2 の盾・g2 のお守り・職の g2 の頭や胴が無く、
 * 買える装備の 1 式が sim の想定 (各職の最良の g2) より弱かった (きつつき→どんぐり で 1 戦 75%、想定 88.5%)。
 * 選び方は「守り×3 + 最大HP + 攻撃×2 + かしこさ×2 + すばやさ×0.5」の いちばん高い品 (sim の bestGearFor と同じ)。
 * 両手の武器・属性の品・店に並べない品 (カジノ・貴重な装備) は選ばない (属性は町のテーマの品として別に並ぶ)。
 */
import { EQUIPMENT, canEquip, type EquipmentDef } from './equipment.js';
import { shopForbiddenDef } from './revive.js';
import type { Archetype } from './types.js';

/** 1 式を足しはじめる tier。 */
export const JOB_SET_MIN_TIER = 2;

const SLOTS = ['weapon', 'shield', 'head', 'armor', 'feet', 'charm'] as const;

const score = (e: EquipmentDef) => (e.bonus.def ?? 0) * 3 + (e.bonus.maxHp ?? 0) + (e.bonus.atk ?? 0) * 2 + (e.bonus.int ?? 0) * 2 + (e.bonus.agi ?? 0) * 0.5;

/** その職がその grade で装備できる 部位ごとの いちばん良い品 (id)。 */
export function jobGradeSet(archetype: Archetype, grade: number): string[] {
  const ok = EQUIPMENT.filter((e) => e.grade === grade && !shopForbiddenDef(e) && !e.element && (e.hands ?? 1) === 1 && canEquip(archetype, e));
  const out: string[] = [];
  for (const slot of SLOTS) {
    const best = ok.filter((e) => e.slot === slot).sort((a, b) => score(b) - score(a))[0];
    if (best) out.push(best.id);
  }
  return out;
}
