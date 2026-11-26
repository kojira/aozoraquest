/**
 * **貴重な装備のまれなドロップを持ち物に入れる** (D-RARE-GEAR-001)。applyBattleOutcome (勝ち) が 1 回呼ぶ純関数。
 * 落ちるかどうかは core の rollGearDrops (サーバーの rewardSeed から)。持ち物がいっぱいなら入れず、持ちかえれなかった品として返す。
 * rkey は `drop-<rewardSeed>-<i>` で決まるので、リトライで同じ品が二重に入らない。
 */
import { rollGearDrops } from '@aozoraquest/core';
import type { GameState, OwnedPiece } from './game-state';
import { heldPieceCount, MAX_OWNED_PIECES } from './shop';

export function grantGearDrops(
  state: GameState,
  monsterIds: readonly string[],
  luk: number,
  rewardSeed: number,
  dropBonus: number,
): { pieces?: OwnedPiece[]; gearDrops: string[]; gearDropsLost: string[] } {
  const got = rollGearDrops(monsterIds, luk, rewardSeed, dropBonus);
  if (got.length === 0) return { gearDrops: [], gearDropsLost: [] };
  const pieces = [...(state.pieces ?? [])];
  const gearDrops: string[] = [];
  const gearDropsLost: string[] = [];
  got.forEach((itemId, i) => {
    const rkey = `drop-${rewardSeed}-${i}`;
    if (pieces.some((p) => p.rkey === rkey)) { gearDrops.push(itemId); return; }
    if (heldPieceCount({ ...state, pieces }) >= MAX_OWNED_PIECES) { gearDropsLost.push(itemId); return; }
    pieces.push({ rkey, itemId, level: 0 });
    gearDrops.push(itemId);
  });
  return { pieces, gearDrops, gearDropsLost };
}
