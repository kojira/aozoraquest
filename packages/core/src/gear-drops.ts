/**
 * **貴重な装備のまれなドロップ** (D-RARE-GEAR-001)。勝ったとき、倒した 1 体ごとに 1 回引く。
 *
 * - 確率は rollDrops と同じ dropChance の式。基礎は MonsterDef.gearDrop.permille / 1000、
 *   運と巫女の直感の上乗せは BATTLE_TUNING.rareGearLukLift 倍 (まれなまま、でも必ず上がる)。
 * - 乱数はサーバーの rewardSeed を別の定数で xor したもの。ふつうのドロップ・魔石の結果は変わらない。
 * - 品が無い・貴重でない (データの崩れ) なら落とさない。持ち物に入れるのは edge (battle-reward)。
 */
import { BATTLE_TUNING } from './battle-tuning.js';
import { createRng } from './battle-rng.js';
import { MONSTERS_BY_ID } from './battle-monsters.js';
import { dropChance } from './battle-rewards.js';
import { EQUIPMENT_BY_ID } from './equipment.js';

/** その敵の貴重な装備が落ちる確率 (0〜0.95)。gearDrop が無ければ 0。 */
export function gearDropChance(monsterId: string, luk: number, dropBonus = 0): number {
  const g = MONSTERS_BY_ID[monsterId]?.gearDrop;
  return g ? dropChance(g.permille / 1000, luk, dropBonus, BATTLE_TUNING.rareGearLukLift) : 0;
}

/** 倒した敵 (群れなら全員) から落ちた貴重な装備の id。決定的 (seed 依存)。 */
export function rollGearDrops(monsterIds: readonly string[], luk: number, seed: number, dropBonus = 0): string[] {
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const out: string[] = [];
  for (const id of monsterIds) {
    const g = MONSTERS_BY_ID[id]?.gearDrop;
    const roll = rng(); // 1 体ごとに 1 回 (gearDrop の無い敵も引いて、並びで結果がずれないようにする)
    if (!g || !EQUIPMENT_BY_ID[g.equipment]?.precious) continue;
    if (roll < gearDropChance(id, luk, dropBonus)) out.push(g.equipment);
  }
  return out;
}
