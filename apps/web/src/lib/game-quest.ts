/**
 * ゲーム内クエスト (#423) の client 側の写しと、セリフ・表示の組み立て (#659)。
 *
 * 進行はサーバーが正。ここが持つのは `/me/state`・受注/達成の応答・決着の応答から
 * 写した値だけで、client は自分で進めない (討伐数は勝利時に edge が数える)。
 * world.tsx はこの写しを state に持ち、NPC 会話とメニューの 1 行に使う。
 */
import { gameQuestById, questProgressLine, type GameQuestDef } from '@aozoraquest/core';
import type { DialogueChoice } from './dialogue';

export interface QuestProgress {
  id: string;
  progress: number;
}

/** 受注中 (active) と達成済み (done) の写し。 */
export interface QuestState {
  active?: QuestProgress;
  done: string[];
}

export const EMPTY_QUEST_STATE: QuestState = { done: [] };

/** `/me/state`・受注・達成の応答 (quest / questsDone を持つ) から写す。 */
export function questStateOf(res: { quest?: QuestProgress | undefined; questsDone?: string[] | undefined }): QuestState {
  return { ...(res.quest ? { active: res.quest } : {}), done: res.questsDone ?? [] };
}

/**
 * 決着の応答で討伐数を同期する。応答に quest が無ければそのまま (戦闘でクエストは
 * 消えないので、古い edge の応答でも受注中を消さない)。
 */
export function questAfterBattle(st: QuestState, quest: QuestProgress | undefined): QuestState {
  return quest ? { ...st, active: quest } : st;
}

/**
 * 受注中で定義が生きているクエスト。定義が消されたもの (管理者がエディタで削除) は
 * 無かったことにする — サーバー側 (handleQuestAccept) も同じ判断で孤児クエストを落とす。
 */
export function activeQuest(st: QuestState): { def: GameQuestDef; progress: number } | undefined {
  if (!st.active) return undefined;
  const def = gameQuestById(st.active.id);
  return def ? { def, progress: st.active.progress } : undefined;
}

/** メニューに出す 1 行 (「そらいろスライムを 3 たい (2/3)」)。受注中でなければ undefined。 */
export function questMenuLine(st: QuestState, materials: Record<string, number>): string | undefined {
  const a = activeQuest(st);
  if (!a) return undefined;
  const o = a.def.objective;
  const have = o.kind === 'defeat' ? a.progress : (materials[o.itemId] ?? 0);
  return `${a.def.title}: ${questProgressLine(a.def, a.progress, materials)}${have >= o.count ? ' 村人に はなそう' : ''}`;
}

export const QUEST_ASK = 'うけますか？';

/** 依頼のセリフ。読み終えたら「うけますか？」で はい/いいえ を聞く。 */
export function questOfferLines(q: GameQuestDef): string[] {
  return [...q.intro, QUEST_ASK];
}

/** 別のクエストを受注中: 依頼は聞けるが受けられない (1 つずつ)。確認は出さない。 */
export function questBusyLines(q: GameQuestDef, active: GameQuestDef): string[] {
  return [...q.intro, `いまは 『${active.title}』を うけおっている。`];
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
