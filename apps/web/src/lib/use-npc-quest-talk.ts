import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { Agent } from '@atproto/api';
import { ITEMS, gameQuestById, gameQuestsByNpc, npcAltLineFor, npcLinesFor, questProgressLine, type GameQuestDef, type NpcDef } from '@aozoraquest/core';
import { scenarioMessagesOf, serverQuestAccept, serverQuestComplete, serverState, serverStoryBattle, WorldServerError, type ScenarioMessage, type ServerEncounter } from '@/lib/world-server';
import type { DialogueChoice } from '@/lib/dialogue';
import { EMPTY_QUEST_STATE, guildQuestDetailLines, questAcceptChoices, questChoiceTitle, questOfferLines, questStateOf, type QuestState } from '@/lib/game-quest';
import { guildReception, npcQuestCandidates, type NpcTalk } from '@/lib/npc-talk';
import { useLatestRef } from '@/lib/use-latest-ref';

/**
 * NPC 会話とゲーム内クエスト (#423/#425/#659) の状態と遷移。受注・報告・進捗は
 * **サーバーが正** で、ここは応答を会話の段 (npcTalk) と表示用の quest に写す。
 */
export function useNpcQuestTalk({ agent, moveBusyRef, tokenRef, flagsRef, materialsRef, applyServerMaterials, setServerPower, setNotice, waitForFreshDirectionRef, startEncounterRef }: {
  agent: Agent | null;
  moveBusyRef: MutableRefObject<boolean>;
  /** 位置トークン。話しかけクエスト (talk) の達成で「相手の隣にいる」をサーバーが確かめる。 */
  tokenRef: MutableRefObject<string | undefined>;
  flagsRef: MutableRefObject<string[]>;
  materialsRef: MutableRefObject<Record<string, number>>;
  applyServerMaterials: (m: Record<string, number>) => void;
  setServerPower: (power: number) => void;
  setNotice: (notice: string | null) => void;
  waitForFreshDirectionRef: MutableRefObject<boolean>;
  /** サーバーが封印した戦闘を始める (会話・受注の後の戦闘。D-STORY-009)。戦闘フックが後で作られるので ref。 */
  startEncounterRef: MutableRefObject<(encounter: ServerEncounter) => void>;
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

  /** 受注する。受注で戦闘が始まったら true (呼び出し側は次の会話を出さない)。 */
  const acceptQuest = useCallback(async (questId: string): Promise<boolean> => {
    if (!agent || moveBusyRef.current) return false;
    moveBusyRef.current = true;
    setQuestPending(true);
    try {
      const res = await serverQuestAccept(agent, questId, tokenRef.current);
      setQuest(questStateOf(res));
      if (res.flags) flagsRef.current = res.flags;
      setNotice(`「${gameQuestById(questId)?.title ?? questId}」を うけおった!`);
      setNpcTalk(null);
      // 受注で始まる戦闘 (startBattle)。受注のセリフの直後に始まる。
      if (res.encounter) startEncounterRef.current(res.encounter);
      return !!res.encounter;
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
  }, [agent, refreshQuestState, setQuest, flagsRef, moveBusyRef, setNotice, tokenRef, startEncounterRef]);

  /** セリフを読み終えた後の戦闘。始められるか (隣にいる・条件のセリフ・未勝利) はサーバーが決める。 */
  const startStoryBattle = useCallback(async (npc: NpcDef) => {
    if (!agent || moveBusyRef.current) return;
    moveBusyRef.current = true;
    try {
      startEncounterRef.current(await serverStoryBattle(agent, npc.id, tokenRef.current));
    } catch (e) {
      setNotice(e instanceof WorldServerError ? e.message : 'つうしんに しっぱいした…');
    } finally {
      moveBusyRef.current = false;
    }
  }, [agent, moveBusyRef, tokenRef, startEncounterRef, setNotice]);

  const guildMessage = (npc: NpcDef, lines: string[]) => setNpcTalk({ npc, guild: 'message', lines });
  const npcQuests = (npc: NpcDef, includeDone = false) =>
    npcQuestCandidates(npc.id, questRef.current, flagsRef.current, materialsRef.current, includeDone);

  const showQuestChoices = (npc: NpcDef, candidates: readonly GameQuestDef[], select: (q: GameQuestDef) => void | Promise<void>, guild: boolean, page = 0, heading = 'どの依頼のこと？') => {
    const choices: DialogueChoice[] = candidates.slice(page * 3, page * 3 + 3).map(q => {
      const active = questRef.current.activeQuests.find(a => a.id === q.id);
      const state = active ? questProgressLine(q, active.progress, materialsRef.current) : questRef.current.done.includes(q.id) ? '達成済み' : '未受注';
      return { label: `${questChoiceTitle(q, candidates)} / ${state}`, onSelect: () => select(q) };
    });
    if (page > 0) choices.push({ label: '前へ', onSelect: () => showQuestChoices(npc, candidates, select, guild, page - 1, heading) });
    if ((page + 1) * 3 < candidates.length) choices.push({ label: '次へ', onSelect: () => showQuestChoices(npc, candidates, select, guild, page + 1, heading) });
    if (!guild) choices.push({ label: '話す', onSelect: () => {
      const alt = npcAltLineFor(npc, flagsRef.current, materialsRef.current);
      // 戦闘つきのセリフは読み終えたら一覧へ戻らず戦闘へ (D-STORY-009)。
      setNpcTalk({ npc, lines: alt?.lines ?? npc.lines, ...(alt?.battle ? { storyBattle: true } : { directList: true }) });
    } });
    choices.push({ label: '戻る', onSelect: () => setNpcTalk(guild ? guildReception(npc) : null) });
    setNpcTalk({ npc, lines: [`${heading}（${page + 1}/${Math.max(1, Math.ceil(candidates.length / 3))}）`], choices, ...(guild ? { guild: 'message' as const } : {}) });
  };

  const reportQuest = async (npc: NpcDef, q: GameQuestDef, guild: boolean, directList = false) => {
    if (!agent || moveBusyRef.current) return;
    const message = (lines: string[], notices: ScenarioMessage[] = []) => setNpcTalk({ npc, lines, ...(notices.length ? { notices } : {}), ...(guild ? { guild: 'message' as const } : { directList }) });
    moveBusyRef.current = true;
    setQuestPending(true);
    try {
      const o = q.objective;
      const res = await serverQuestComplete(agent, q.id, o.kind === 'talk' ? tokenRef.current : undefined);
      setQuest(questStateOf(res));
      if (res.flags) flagsRef.current = res.flags;
      setServerPower(res.power);
      applyServerMaterials(res.materials);
      const r = res.rewarded;
      const got = [r?.itemId ? `${ITEMS[r.itemId]?.name ?? r.itemId} ×${r.count}` : null,
        r?.power ? `あおぞらパワー ${r.power}` : null].filter(Boolean).join(' と ');
      // talk は相手のセリフ (いつものセリフの代わり) に続けて達成を出す (D-STORY-009)。
      const said = o.kind === 'talk' ? [o.line, `『${q.title}』を たっせいした！`] : q.done;
      message([...said, ...(got ? [`${got} を もらった！`] : [])], scenarioMessagesOf(res.scenarioMessages, res.notices));
    } catch (e) {
      try { await refreshQuestState(); } catch { /* Keep only the last confirmed snapshot. */ }
      if (questRef.current.done.includes(q.id)) message(['この依頼は 達成済みだよ。']);
      else if (e instanceof WorldServerError && e.code === 'not_ready' && q.objective.kind !== 'talk') message([...(q.progress ?? []), e.message, 'そろったら また 報告してね。']);
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
    // 1件でも一覧から選ぶ。選んだら説明・確認なしで報告する (未達はサーバーの不足表示)。
    showQuestChoices(npc, candidates, q => reportQuest(npc, q, true), true, 0, 'どの依頼を 報告する？');
  };
  const selectDirectQuest = (npc: NpcDef, q: GameQuestDef, directList: boolean) => {
    const active = questRef.current.activeQuests.find(a => a.id === q.id);
    // talk の報告先は相手の NPC (openDirectNpc)。依頼主には進み具合だけ話す。
    if (active && q.objective.kind === 'talk') setNpcTalk({ npc, lines: [...(q.progress ?? ['たのんだよ。']), questProgressLine(q, active.progress, materialsRef.current)], directList });
    else if (active) return reportQuest(npc, q, false, directList);
    else setNpcTalk({ npc, lines: questOfferLines(q), acceptQuestId: q.id, directList });
  };
  const directQuestList = (npc: NpcDef) => showQuestChoices(npc, npcQuests(npc), q => selectDirectQuest(npc, q, true), false);
  const openDirectNpc = (npc: NpcDef) => {
    // 受けている話しかけクエストの相手なら、いつものセリフの代わりに達成へ進む (D-STORY-009)。
    const talkQuest = questRef.current.activeQuests.map(a => gameQuestById(a.id))
      .find(q => q?.objective.kind === 'talk' && q.objective.npcId === npc.id);
    if (talkQuest) { void reportQuest(npc, talkQuest, false); return; }
    const candidates = npcQuests(npc);
    if (candidates.length > 1) directQuestList(npc);
    else if (candidates.length === 1) selectDirectQuest(npc, candidates[0]!, false);
    else {
      const alt = npcAltLineFor(npc, flagsRef.current, materialsRef.current);
      setNpcTalk({ npc, lines: alt?.lines ?? npc.lines, ...(alt?.battle ? { storyBattle: true } : {}) });
    }
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
          if (await acceptQuest(acceptQuestId)) return;
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
      if (await acceptQuest(id)) return;
      if (directList) directQuestList(npc);
    });
  }

  return { npcTalk, setNpcTalk, npcTalkRef, quest, setQuest, questPending, npcChoices, openDirectNpc, directQuestList, startStoryBattle };
}
