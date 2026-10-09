/**
 * ゲーム内クエスト (#423) の client 側の写しと、セリフ・表示の組み立て (#659)。
 *
 * 進行はサーバーが正。ここが持つのは `/me/state`・受注/達成の応答・決着の応答から
 * 写した値だけで、client は自分で進めない (討伐数は勝利時に edge が数える)。
 * world.tsx はこの写しを state に持ち、NPC 会話と「クエスト」窓の受注一覧に使う。
 */
import { ITEMS, allNpcs, gameQuestById, interiorById, questObjectiveText, questProgressLine, type GameQuestDef } from '@aozoraquest/core';
import type { DialogueChoice } from './dialogue';

export interface QuestProgress {
  id: string;
  progress: number;
}

/** 受注中 (activeQuests) と達成済み (done) の写し。 */
export interface QuestState {
  activeQuests: QuestProgress[];
  done: string[];
}

export const EMPTY_QUEST_STATE: QuestState = { activeQuests: [], done: [] };

export function questStateOf(res: { activeQuests?: QuestProgress[]; questsDone?: string[] }): QuestState {
  return { activeQuests: res.activeQuests ?? [], done: res.questsDone ?? [] };
}

/** Missing snapshot means an unsettled turn; an explicit empty snapshot clears the list. */
export function questAfterBattle(st: QuestState, activeQuests: QuestProgress[] | undefined, done?: string[]): QuestState {
  return activeQuests === undefined ? st : { activeQuests, done: done ?? st.done };
}

/** 「クエスト」窓の 1 項目。区分は発注 NPC がギルド受付 (guildReception) かで決める。 */
export interface QuestLogEntry {
  id: string;
  section: 'guild' | 'personal';
  title: string;
  /** 「依頼: むらおさ（ふたばの村）」。定義が消えた受注では無い。 */
  giver?: string;
  progress?: string;
  ready: boolean;
  /** タップで開く「条件: … 報酬: …」 */
  detail?: string;
}

export function questLogEntries(st: QuestState, materials: Record<string, number>): QuestLogEntry[] {
  return st.activeQuests.map((q): QuestLogEntry => {
    const def = gameQuestById(q.id);
    if (!def) return { id: q.id, section: 'personal', title: `依頼情報を確認できません（${q.id}）`, ready: false };
    const o = def.objective;
    const npc = allNpcs().find(n => n.id === def.npcId);
    const guild = npc?.guildReception === true;
    const place = npc?.mapId ? interiorById(npc.mapId)?.name : undefined;
    const where = [place, guild ? 'ギルド' : undefined].filter(Boolean).join(' ');
    const have = o.kind === 'talk' ? 0 : o.kind === 'defeat' ? q.progress : (materials[o.itemId] ?? 0);
    return {
      id: q.id,
      section: guild ? 'guild' : 'personal',
      title: def.title,
      giver: `依頼: ${npc?.name ?? def.npcId}${where ? `（${where}）` : ''}`,
      progress: questProgressLine(def, q.progress, materials),
      ready: o.kind !== 'talk' && have >= o.count,
      detail: questTermsLine(def),
    };
  });
}

/** Shared by guild and direct NPC choices, including identical titles/objectives. */
export function questChoiceTitle(q: GameQuestDef, candidates: readonly GameQuestDef[]): string {
  const same = candidates.filter(c => c.title === q.title);
  if (same.length < 2) return q.title;
  const objective = questObjectiveText(q);
  return `${q.title}・${objective}${same.filter(c => questObjectiveText(c) === objective).length > 1 ? `（${q.id}）` : ''}`;
}

/** 「条件: … 報酬: …。」 ギルド受付の詳細と「クエスト」窓の展開で共有する。 */
export function questTermsLine(q: GameQuestDef): string {
  const reward = [
    q.reward?.itemId ? `${ITEMS[q.reward.itemId]?.name ?? q.reward.itemId} ×${q.reward.count}` : null,
    q.reward?.power ? `あおぞらパワー ${q.reward.power}` : null,
  ].filter(Boolean).join(' と ') || 'なし';
  return `条件: ${questObjectiveText(q)}。報酬: ${reward}。`;
}

export const QUEST_ASK = 'うけますか？';

/** 受付でも管理データの条件・報酬を表示し、納品による消費を受注前に伝える。 */
export function guildQuestDetailLines(q: GameQuestDef): string[] {
  return [
    `『${q.title}』`, ...q.intro,
    questTermsLine(q),
    ...(q.objective.kind === 'collect' ? [`報告が 成功すると ${questObjectiveText(q)} わたします。いまの 所持品も つかえます。`] : []),
    '一人一度の 依頼です。',
  ];
}

/** 依頼のセリフ。読み終えたら「うけますか？」で はい/いいえ を聞く。 */
export function questOfferLines(q: GameQuestDef): string[] {
  return [...q.intro, QUEST_ASK];
}

/**
 * 「うけますか？」の はい/いいえ。questId が無い会話 (通常セリフ・達成) では選択肢を出さない。
 * いいえ は何もしない (窓が閉じるだけ。次に話せばまた聞ける)。
 */
export function questAcceptChoices(questId: string | undefined, onYes: (questId: string) => void | Promise<void>): DialogueChoice[] | undefined {
  if (!questId) return undefined;
  return [
    { label: 'はい', onSelect: () => onYes(questId) },
    { label: 'いいえ', onSelect: () => {} },
  ];
}
