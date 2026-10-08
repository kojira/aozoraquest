import { gameQuestsByNpc, itemsSatisfied, type GameQuestDef, type NpcDef } from '@aozoraquest/core';
import type { DialogueChoice } from '@/lib/dialogue';
import type { QuestState } from '@/lib/game-quest';
import type { ScenarioMessage } from '@/lib/world-server';

/** NPC 会話 (#425/#423)。lines は通常セリフかクエスト文脈のセリフ。acceptQuestId が
 *  あるときは**読み終えたら はい/いいえ で受注を聞く** (#659)。 */
export interface NpcTalk {
  npc: NpcDef;
  lines: string[];
  acceptQuestId?: string;
  guild?: 'reunion' | 'menu' | 'detail' | 'message';
  choices?: DialogueChoice[];
  directList?: boolean;
  /** 会話の後に地の文で続けるシナリオのお知らせ (報告で発火。D-STORY-007)。 */
  notices?: ScenarioMessage[];
  /** 読み終えたら戦闘になるセリフ (altLine.battle。始めるかはサーバーが決める。D-STORY-009)。 */
  storyBattle?: boolean;
}

/** ギルド受付のメニュー段。 */
export const guildReception = (npc: NpcDef) => ({ npc, guild: 'menu' as const, lines: ['冒険者ギルドへ ようこそ。どうする？'] });

/** その NPC から いま話題にできる依頼。受注中は常に、達成済みは includeDone のときだけ、
 *  未受注は進行フラグと持ち物の条件を満たすものだけ。 */
export function npcQuestCandidates(
  npcId: string,
  quest: QuestState,
  flags: readonly string[],
  materials: Readonly<Record<string, number>>,
  includeDone = false,
): GameQuestDef[] {
  return gameQuestsByNpc(npcId).filter(q =>
    quest.activeQuests.some(a => a.id === q.id)
    || (quest.done.includes(q.id) ? includeDone
      : (q.requireFlags ?? []).every(f => flags.includes(f)) && itemsSatisfied(q.requireItems, materials)));
}
