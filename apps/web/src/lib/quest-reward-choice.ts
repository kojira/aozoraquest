/**
 * クエストの最後に選ぶ装備 (D-RARE-GEAR-001)。一覧は core の questRewardChoices (edge と同じ)。
 * ここは選択肢の文字だけ: 「なまえ（ぶき こうげき +7）」。
 */
import { EQUIPMENT_BY_ID, GEAR_SLOT_LABELS, bonusText, partyDefsOf, questRewardChoices, recruitById, withCharacterNames, type Archetype, type GameQuestDef } from '@aozoraquest/core';
import type { ServerParty } from '@/lib/world-server';

/** 選択肢の 1 行。 */
export function rewardChoiceLabel(id: string): string {
  const def = EQUIPMENT_BY_ID[id];
  if (!def) return id;
  return `${withCharacterNames(def.name)}（${GEAR_SLOT_LABELS[def.slot]} ${bonusText(def.bonus)}）`;
}

/** 主人公 (職が分かれば) と今の仲間に合う品。主人公の品が先。 */
export function rewardChoicesFor(q: GameQuestDef, hero: string | null, party: ServerParty): string[] {
  const mates = partyDefsOf(party, recruitById, 1).map((a) => a.archetype);
  return questRewardChoices(q, hero ? [hero as Archetype, ...mates] : mates);
}
