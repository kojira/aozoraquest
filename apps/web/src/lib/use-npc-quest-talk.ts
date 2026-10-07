import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { Agent } from '@atproto/api';
import { ITEMS, gameQuestById, gameQuestsByNpc, npcLinesFor, questProgressLine, type GameQuestDef, type NpcDef } from '@aozoraquest/core';
import { scenarioMessagesOf, serverQuestAccept, serverQuestComplete, serverState, WorldServerError, type ScenarioMessage } from '@/lib/world-server';
import type { DialogueChoice } from '@/lib/dialogue';
import { EMPTY_QUEST_STATE, guildQuestDetailLines, questAcceptChoices, questChoiceTitle, questOfferLines, questStateOf, type QuestState } from '@/lib/game-quest';
import { guildReception, npcQuestCandidates, type NpcTalk } from '@/lib/npc-talk';
import { useLatestRef } from '@/lib/use-latest-ref';

/**
 * NPC 会話とゲーム内クエスト (#423/#425/#659) の状態と遷移。受注・報告・進捗は
 * **サーバーが正** で、ここは応答を会話の段 (npcTalk) と表示用の quest に写す。
 */
export function useNpcQuestTalk({ agent, moveBusyRef, flagsRef, materialsRef, applyServerMaterials, setServerPower, setNotice, waitForFreshDirectionRef }: {
  agent: Agent | null;
  moveBusyRef: MutableRefObject<boolean>;
  flagsRef: MutableRefObject<string[]>;
  materialsRef: MutableRefObject<Record<string, number>>;
  applyServerMaterials: (m: Record<string, number>) => void;
  setServerPower: (power: number) => void;
  setNotice: (notice: string | null) => void;
  waitForFreshDirectionRef: MutableRefObject<boolean>;
}) {
  const [npcTalk, setNpcTalk] = useState<NpcTalk | null>(null);
  /** ゲーム内クエストの進行 (#423)。**サーバーが正** — 受注/達成/決着の応答と serverState だけが書く。
   *  state (メニューの全受注一覧に出す) + ref (バンプ判定は state 更新を待たずに最新を読む)。 */
  const [quest, setQuestState] = useState<QuestState>(EMPTY_QUEST_STATE);
  const questRef = useRef(quest);
  const setQuest = useCallback((next: QuestState | ((s: QuestState) => QuestState)) => {
    const value = typeof next === 'function' ? next(questRef.current) : next;
    questRef.current = value;
    setQuestState(value);
  }, []);
  const npcTalkRef = useLatestRef(npcTalk);
  const [questPending, setQuestPending] = useState(false);

  const refreshQuestState = useCallback(async () => {
    if (!agent) return;
    const { state } = await serverState(agent);
    setQuest(questStateOf(state));
    flagsRef.current = state.flags ?? [];
    setServerPower(state.power ?? 0);
    applyServerMaterials(state.materials ?? {});
  }, [agent, setQuest, applyServerMaterials, flagsRef, setServerPower]);

  const acceptQuest = useCallback(async (questId: string) => {
    if (!agent || moveBusyRef.current) return;
    moveBusyRef.current = true;
    setQuestPending(true);
    try {
      const res = await serverQuestAccept(agent, questId);
      setQuest(questStateOf(res));
      if (res.flags) flagsRef.current = res.flags;
      setNotice(`「${gameQuestById(questId)?.title ?? questId}」を うけおった!`);
      setNpcTalk(null);
    } catch (e) {
      try {
        await refreshQuestState();
        // A lost response may already have accepted this quest, or another tab chose one.
        if (questRef.current.activeQuests.some(q => q.id === questId) || questRef.current.done.includes(questId)) setNpcTalk(null);
      } catch { /* Keep the offer retryable; do not infer acceptance from a failed request. */ }
      const message = e instanceof WorldServerError ? e.message : 'つうしんに しっぱいした…';
      setNotice(message);
      // The map notice is hidden during NPC dialogue: keep failure and retry visible in the offer.
      setNpcTalk(current => current?.acceptQuestId === questId && !current.guild
        ? { ...current, lines: [message, 'もういちど たしかめてね。うけますか？'] }
        : current);
      throw e;
    } finally {
      moveBusyRef.current = false;
      setQuestPending(false);
    }
  }, [agent, refreshQuestState, setQuest, flagsRef, moveBusyRef, setNotice]);

  const guildMessage = (npc: NpcDef, lines: string[]) => setNpcTalk({ npc, guild: 'message', lines });
  const npcQuests = (npc: NpcDef, includeDone = false) =>
    npcQuestCandidates(npc.id, questRef.current, flagsRef.current, materialsRef.current, includeDone);

  const showQuestChoices = (npc: NpcDef, candidates: readonly GameQuestDef[], select: (q: GameQuestDef) => void | Promise<void>, guild: boolean, page = 0) => {
    const choices: DialogueChoice[] = candidates.slice(page * 3, page * 3 + 3).map(q => {
      const active = questRef.current.activeQuests.find(a => a.id === q.id);
      const state = active ? questProgressLine(q, active.progress, materialsRef.current) : questRef.current.done.includes(q.id) ? '達成済み' : '未受注';
      return { label: `${questChoiceTitle(q, candidates)} / ${state}`, onSelect: () => select(q) };
    });
    if (page > 0) choices.push({ label: '前へ', onSelect: () => showQuestChoices(npc, candidates, select, guild, page - 1) });
    if ((page + 1) * 3 < candidates.length) choices.push({ label: '次へ', onSelect: () => showQuestChoices(npc, candidates, select, guild, page + 1) });
    if (!guild) choices.push({ label: '話す', onSelect: () => setNpcTalk({ npc, lines: npcLinesFor(npc, flagsRef.current, materialsRef.current), directList: true }) });
    choices.push({ label: '戻る', onSelect: () => setNpcTalk(guild ? guildReception(npc) : null) });
    setNpcTalk({ npc, lines: [`どの依頼のこと？（${page + 1}/${Math.max(1, Math.ceil(candidates.length / 3))}）`], choices, ...(guild ? { guild: 'message' as const } : {}) });
  };

  const reportQuest = async (npc: NpcDef, q: GameQuestDef, guild: boolean, directList = false) => {
    if (!agent || moveBusyRef.current) return;
    const message = (lines: string[], notices: ScenarioMessage[] = []) => setNpcTalk({ npc, lines, ...(notices.length ? { notices } : {}), ...(guild ? { guild: 'message' as const } : { directList }) });
    moveBusyRef.current = true;
    setQuestPending(true);
    try {
      const res = await serverQuestComplete(agent, q.id);
      setQuest(questStateOf(res));
      if (res.flags) flagsRef.current = res.flags;
      setServerPower(res.power);
      applyServerMaterials(res.materials);
      const r = res.rewarded;
      const got = [r?.itemId ? `${ITEMS[r.itemId]?.name ?? r.itemId} ×${r.count}` : null,
        r?.power ? `あおぞらパワー ${r.power}` : null].filter(Boolean).join(' と ');
      message([...q.done, ...(got ? [`${got} を もらった！`] : [])], scenarioMessagesOf(res.scenarioMessages, res.notices));
    } catch (e) {
      try { await refreshQuestState(); } catch { /* Keep only the last confirmed snapshot. */ }
      if (questRef.current.done.includes(q.id)) message(['この依頼は 達成済みだよ。']);
      else if (e instanceof WorldServerError && e.code === 'not_ready') message([...(q.progress ?? []), e.message, 'そろったら また 報告してね。']);
      else message([e instanceof WorldServerError ? e.message : 'つうしんに しっぱいした… もういちど 報告してね。']);
    } finally {
      moveBusyRef.current = false;
      setQuestPending(false);
    }
  };

  const viewGuildQuest = (npc: NpcDef, q?: GameQuestDef) => {
    if (!q) {
      const candidates = npcQuests(npc, true);
      if (!candidates.length) { guildMessage(npc, ['いま 紹介できる 依頼は ないよ。']); return; }
      if (candidates.length > 1) { showQuestChoices(npc, candidates, selected => viewGuildQuest(npc, selected), true); return; }
      q = candidates[0]!;
    }
    const lines = guildQuestDetailLines(q);
    const active = questRef.current.activeQuests.find(a => a.id === q.id);
    if (questRef.current.done.includes(q.id)) guildMessage(npc, [...lines, 'この依頼は 達成済みだよ。ありがとう！']);
    else if (active) guildMessage(npc, [...lines, questProgressLine(q, active.progress, materialsRef.current), 'そろったら「報告する」を えらんでね。']);
    else setNpcTalk({ npc, guild: 'detail', lines: [...lines, 'うけますか？'], acceptQuestId: q.id });
  };
  const reportGuildQuest = (npc: NpcDef) => {
    const candidates = gameQuestsByNpc(npc.id).filter(q => questRef.current.activeQuests.some(a => a.id === q.id));
    if (!candidates.length) { guildMessage(npc, ['いま 報告できる 受注中の依頼は ないよ。']); return; }
    const confirm = (q: GameQuestDef) => setNpcTalk({ npc, guild: 'message', lines: [...guildQuestDetailLines(q), 'この依頼を 報告しますか？'], choices: [
      { label: '報告する', onSelect: () => reportQuest(npc, q, true) },
      { label: '戻る', onSelect: () => setNpcTalk(guildReception(npc)) },
    ] });
    if (candidates.length === 1) confirm(candidates[0]!);
    else showQuestChoices(npc, candidates, confirm, true);
  };
  const selectDirectQuest = (npc: NpcDef, q: GameQuestDef, directList: boolean) => {
    if (questRef.current.activeQuests.some(a => a.id === q.id)) return reportQuest(npc, q, false, directList);
    else setNpcTalk({ npc, lines: questOfferLines(q), acceptQuestId: q.id, directList });
  };
  const directQuestList = (npc: NpcDef) => showQuestChoices(npc, npcQuests(npc), q => selectDirectQuest(npc, q, true), false);
  const openDirectNpc = (npc: NpcDef) => {
    const candidates = npcQuests(npc);
    if (candidates.length > 1) directQuestList(npc);
    else if (candidates.length === 1) selectDirectQuest(npc, candidates[0]!, false);
    else setNpcTalk({ npc, lines: npcLinesFor(npc, flagsRef.current, materialsRef.current) });
  };

  let npcChoices: DialogueChoice[] | undefined = npcTalk?.choices;
  if (npcTalk?.guild === 'menu') {
    const npc = npcTalk.npc;
    npcChoices = [
      { label: '依頼を見る', onSelect: () => viewGuildQuest(npc) },
      { label: '報告する', onSelect: () => reportGuildQuest(npc) },
      { label: '話す', onSelect: () => guildMessage(npc, npcLinesFor(npc, flagsRef.current, materialsRef.current)) },
      { label: 'やめる', onSelect: () => { waitForFreshDirectionRef.current = true; setNpcTalk(null); } },
    ];
  } else if (npcTalk?.guild === 'detail' && npcTalk.acceptQuestId) {
    const { npc, acceptQuestId } = npcTalk;
    npcChoices = [
      { label: '受注する', onSelect: async () => {
        try {
          await acceptQuest(acceptQuestId);
          guildMessage(npc, [`『${gameQuestById(acceptQuestId)?.title ?? acceptQuestId}』を うけおった！`, 'そろったら ギルドで 報告してね。']);
        } catch (e) {
          guildMessage(npc, [e instanceof WorldServerError ? e.message : 'つうしんに しっぱいした… もういちど たしかめてね。']);
        }
      } },
      { label: 'やめておく', onSelect: () => setNpcTalk(guildReception(npc)) },
    ];
  } else if (npcTalk?.acceptQuestId) {
    const { npc, directList } = npcTalk;
    npcChoices = questAcceptChoices(npcTalk.acceptQuestId, async id => {
      await acceptQuest(id);
      if (directList) directQuestList(npc);
    });
  }

  return { npcTalk, setNpcTalk, npcTalkRef, quest, setQuest, questPending, npcChoices, openDirectNpc, directQuestList };
}
