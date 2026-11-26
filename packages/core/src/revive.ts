/**
 * 倒れた仲間を起こす手と、回復のどうぐの量 (D-REVIVE-001)。
 *
 * - 生き返らせるとくぎ・全回復のとくぎは、ここで SKILLS に足す (skills.ts は大きいので増やさない)。
 *   覚える職と Lv は battle-job-skills の JOB_KITS。
 * - 生き返らせるのは heal 効果の target 'oneDownAlly' (倒れた味方 1 人)。
 * - とくぎの MP は全とくぎ共通 (BATTLE_TUNING.skillMpCost) だが、ここに載せたとくぎだけ倍にする。
 * - 回復のどうぐは **決まった量** (amount) で回復する。割合 (ratio) で回復するどうぐと生き返らせるどうぐは
 *   **貴重なもの** で、店には並ばない (isShopForbiddenItem。判定はここ 1 か所)。
 */
import { SKILLS, effectTarget, type SkillDef, type SkillEffect } from './skills.js';
import { ITEMS, type ItemDef } from './battle-monsters.js';
import { BATTLE_TUNING } from './battle-tuning.js';

/** 足すとくぎ。 */
export const REVIVE_SKILLS: Readonly<Record<string, SkillDef>> = {
  // 目覚めの祈り: 倒れた味方 1 人を最大 HP の 4 割で起こす (巫女・聖騎士)。3 割だと決戦で起こしてもすぐ倒れる (sim 59→64%)。
  'revive-prayer': { id: 'revive-prayer', effects: [{ kind: 'heal', ratio: 0.4, target: 'oneDownAlly' }] },
  // 味方 1 人を全回復 (賢者・巫女・聖騎士)。
  'full-heal-one': { id: 'full-heal-one', effects: [{ kind: 'heal', ratio: 1, target: 'oneAlly' }] },
  // 味方みんなを全回復 (賢者・巫女)。HP だけ (状態異常は治らない)。
  'full-heal-all': { id: 'full-heal-all', effects: [{ kind: 'heal', ratio: 1, target: 'allAllies' }] },
};
Object.assign(SKILLS, REVIVE_SKILLS);

/** とくぎの MP の倍率 (ここに無いとくぎは 1 倍)。 */
export const SKILL_MP_FACTOR: Readonly<Record<string, number>> = {
  'revive-prayer': 2, // 3 倍だと決戦で 1 回しか唱えられない (sim)
  'full-heal-one': 3,
  'full-heal-all': 5,
};

/** 倒れた味方 1 人をねらう効果か。 */
export const isReviveEffect = (e: SkillEffect): boolean => effectTarget(e) === 'oneDownAlly';

/** 倒れた味方 1 人を選んで使うとくぎか。 */
export function skillTargetsDownAlly(kind: string): boolean {
  return !!SKILLS[kind]?.effects.some(isReviveEffect);
}

/** 倒れた味方 1 人を選んで使うどうぐか。 */
export function itemTargetsDownAlly(itemId: string): boolean {
  return !!ITEMS[itemId]?.battle?.effects.some(isReviveEffect);
}

/**
 * **店に並べてはいけない品** (オーナーの決まり: 生き返らせるどうぐは なんでも屋 で買えない)。
 * カジノの景品・貴重なもの (precious)・生き返らせるどうぐ・割合で回復するどうぐ。
 * 生成の品ぞろえ・店の上書き・買う処理が、みなここを見る。
 */
export function isShopForbiddenItem(id: string): boolean {
  const def = ITEMS[id];
  return !!def && shopForbiddenDef(def);
}

/** isShopForbiddenItem の中身 (保存の検査が、入れ替える前の定義で使う)。 */
export function shopForbiddenDef(def: ItemDef): boolean {
  if (def.casinoOnly || def.precious) return true;
  return !!def.battle?.effects.some((e) => isReviveEffect(e) || (e.kind === 'heal' && e.amount === undefined));
}

/**
 * どうぐ 1 つで戻る HP (決まった量)。やくそうは BATTLE_TUNING.herbHealAmount、
 * ほかは戦闘の効果の amount (1 人ぶん)。回復しない品は 0。最大 HP を超えるぶんは呼ぶ側で切る。
 */
export function itemHealAmount(itemId: string): number {
  if (itemId === 'herb') return BATTLE_TUNING.herbHealAmount;
  const heal = ITEMS[itemId]?.battle?.effects.find((e) => e.kind === 'heal');
  return heal?.kind === 'heal' ? (heal.amount ?? 0) : 0;
}
