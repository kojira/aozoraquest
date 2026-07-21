/**
 * マルチ戦闘のターゲット解決 (#453 / docs/25 §14.4)。
 *
 * とくぎは `SkillTarget` で「誰に効くか」を宣言し、エンジンが対象集合を解決して各対象に
 * EFFECT_HANDLER を適用する (ループはエンジン側・ハンドラは 1 対象分)。ソロ戦闘は
 * allies=[player] / enemies=[monster] の特殊ケースとして同じ解決に乗る。
 *
 * このモジュールは Combatant 配列に対する純関数のみ (BattleState 非依存)。
 */

import type { Combatant } from './battle.js';

/** とくぎの対象種別 (docs/25 §14.4)。 */
export type SkillTarget = 'self' | 'oneEnemy' | 'allEnemies' | 'oneAlly' | 'allAllies';

/** 戦闘の両陣営 (味方 = player+召喚+NPC / 敵 = モンスター群)。 */
export interface CombatSides {
  allies: Combatant[];
  enemies: Combatant[];
}

/** 生存者のみ (hp>0)。 */
function alive(arr: readonly Combatant[]): Combatant[] {
  return arr.filter((c) => c.hp > 0);
}

/**
 * 使用者 `caster` の視点で `target` を対象集合に解決する。
 * - caster が allies 側なら「味方=allies / 敵=enemies」、enemies 側なら反転 (敵もとくぎを撃つ #453)。
 * - one系は `targetIndex` で生存者の何番目かを選ぶ (未指定=先頭)。対象が全滅なら空配列。
 * - self は生死に関わらず caster 自身 (自己回復・自己バフ)。
 */
export function resolveTargets(
  caster: Combatant,
  target: SkillTarget,
  sides: CombatSides,
  opts: { targetIndex?: number } = {},
): Combatant[] {
  const isAlly = sides.allies.includes(caster);
  const ownSide = isAlly ? sides.allies : sides.enemies;
  const foeSide = isAlly ? sides.enemies : sides.allies;
  switch (target) {
    case 'self':
      return [caster];
    case 'allAllies':
      return alive(ownSide);
    case 'allEnemies':
      return alive(foeSide);
    case 'oneAlly': {
      const list = alive(ownSide);
      return [list[opts.targetIndex ?? 0] ?? caster];
    }
    case 'oneEnemy': {
      const list = alive(foeSide);
      const picked = list[opts.targetIndex ?? 0];
      return picked ? [picked] : [];
    }
  }
}

/** その target が敵陣を狙うか (UI のターゲット選択要否判定などに)。 */
export function targetsEnemies(target: SkillTarget): boolean {
  return target === 'oneEnemy' || target === 'allEnemies';
}

/** その target が単体指定か (UI で対象を選ばせる必要があるか)。 */
export function isSingleTarget(target: SkillTarget): boolean {
  return target === 'oneEnemy' || target === 'oneAlly';
}
