/**
 * **クエストの報酬の装備** (D-RARE-GEAR-001)。handleQuestComplete の mutate が 1 回呼ぶ純関数。
 * - reward.equipment: その 1 品。
 * - reward.choices: 主人公 (診断の職) と今の仲間に合う品の一覧 (core の questRewardChoices) を作り直し、
 *   その中の品だけを通す。選んでいなければ choice_required、一覧に無ければ choice_invalid。
 * - 持ち物がいっぱいなら pieces_full (達成しない。宝箱と同じ)。rkey は questPieceRkey で決まる (二重に入らない)。
 */
import { partyDefsOf, questPieceRkey, questRewardChoices, recruitById, type Archetype, type GameQuestDef } from '@aozoraquest/core';
import type { GameState, OwnedPiece } from './game-state';
import { GameQuestError } from './game-quest';
import { heldPieceCount, MAX_OWNED_PIECES } from './shop';
import { readDiagnosis } from './battle-resolver';

/** router から渡す、選んだ品と主人公の職の読み方 (職は診断。要るときだけ読む)。 */
export function questRewardInput(did: string, ns: string, choice: unknown): { choice?: unknown; heroArchetype: () => Promise<Archetype> } {
  return { choice, heroArchetype: async () => (await readDiagnosis(did, ns)).archetype };
}

export function questEquipmentReward(cur: GameState, def: GameQuestDef, choice: unknown, hero: Archetype | undefined): { equipment: string; pieces: OwnedPiece[] } | null {
  let equipment = def.reward?.equipment;
  if (def.reward?.choices?.length) {
    const mates = partyDefsOf(cur.party, recruitById, 1).map((a) => a.archetype);
    const options = questRewardChoices(def, hero ? [hero, ...mates] : [...mates]);
    if (choice === undefined || choice === null) throw new GameQuestError('ほうびを えらんでほしい', 400, 'choice_required');
    if (typeof choice !== 'string' || !options.includes(choice)) throw new GameQuestError('その品は えらべない', 400, 'choice_invalid');
    equipment = choice;
  }
  if (!equipment) return null;
  const pieces = [...(cur.pieces ?? [])];
  const rkey = questPieceRkey(def.id);
  if (pieces.some((p) => p.rkey === rkey)) return { equipment, pieces };
  if (heldPieceCount(cur) >= MAX_OWNED_PIECES) throw new GameQuestError(`もちものが いっぱいだ (${MAX_OWNED_PIECES} 個)。すてるか きたえて へらしてほしい`, 400, 'pieces_full');
  pieces.push({ rkey, itemId: equipment, level: 0 });
  return { equipment, pieces };
}
