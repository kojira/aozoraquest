import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Agent } from '@atproto/api';
import { ITEMS, gameQuestById, gameQuestsByNpc, npcAltLineFor, npcLinesFor, partyCapacity, questProgressLine, recruits, RECRUIT_GACHA, type GameQuestDef, type NpcDef } from '@aozoraquest/core';
import { scenarioMessagesOf, serverPartyCandidates, serverPartyReroll, serverPartySet, serverQuestAccept, serverQuestComplete, serverState, serverStoryBattle, WorldServerError, type ScenarioMessage, type ServerEncounter, type ServerParty } from '@/lib/world-server';
import { PARTY_LINES } from '@/lib/party-lines';
import type { DialogueChoice } from '@/lib/dialogue';
import { EMPTY_QUEST_STATE, guildQuestDetailLines, questAcceptChoices, questChoiceTitle, questOfferLines, questStateOf, type QuestState } from '@/lib/game-quest';
import { guildReception, npcQuestCandidates, type NpcTalk } from '@/lib/npc-talk';
import { useLatestRef } from '@/lib/use-latest-ref';

/** 依頼一覧の 1 ページの件数。390px の地図に貼った会話窓 (高さ 35%) に、見出し + 依頼 + 下端の操作の段が収まる数。 */
export const QUEST_CHOICES_PER_PAGE = 2;

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
  /** いまのパーティの仲間 id (D-PARTY-001)。危険度が見えるか (seesFieldDanger) に使う。権威 state の読み・編成の応答だけが書く。 */
  const [party, setParty] = useState<ServerParty>({ ids: [] });
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
      setNotice(`「${gameQuestById(questId)?.title ?? questId}」を請け負った!`);
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
      const message = e instanceof WorldServerError ? e.message : '通信に失敗した…';
      setNotice(message);
      // The map notice is hidden during NPC dialogue: keep failure and retry visible in the offer.
      setNpcTalk(current => current?.acceptQuestId === questId && current.guild !== 'detail'
        ? { ...current, lines: [message, 'もう一度確かめてね。うけますか？'] }
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
      setNotice(e instanceof WorldServerError ? e.message : '通信に失敗した…');
    } finally {
      moveBusyRef.current = false;
    }
  }, [agent, moveBusyRef, tokenRef, startEncounterRef, setNotice]);

  const guildMessage = (npc: NpcDef, lines: string[]) => setNpcTalk({ npc, guild: 'message', lines });
  const npcQuests = (npc: NpcDef) =>
    npcQuestCandidates(npc.id, questRef.current, flagsRef.current, materialsRef.current);
  const isActive = (q: GameQuestDef) => questRef.current.activeQuests.some(a => a.id === q.id);
  /** ギルドの「依頼を見る」に出す依頼。個人の頼みごと (personal) は受付の「話す」で頼むので出さない。 */
  const guildBoardQuests = (npc: NpcDef) => npcQuests(npc).filter(q => !q.personal);
  /** 「報告する」に出す受注中の依頼 (個人の頼みごとも含む)。 */
  const guildReportQuests = (npc: NpcDef) => gameQuestsByNpc(npc.id).filter(isActive);

  /** lead = 一覧の前に話すセリフ (受付の「話す」の続き)。開いたときだけ出し、前へ・次へでは出さない。
   *  1 ページは QUEST_CHOICES_PER_PAGE 件 (390px の会話窓に収まる数)。前へ・次へ・話す・戻るは窓の下端に張りつける。 */
  const showQuestChoices = (npc: NpcDef, candidates: readonly GameQuestDef[], select: (q: GameQuestDef) => void | Promise<void>, guild: boolean, page = 0, heading = 'どの依頼のこと？', lead: readonly string[] = []) => {
    const start = page * QUEST_CHOICES_PER_PAGE;
    const choices: DialogueChoice[] = candidates.slice(start, start + QUEST_CHOICES_PER_PAGE).map(q => {
      const active = questRef.current.activeQuests.find(a => a.id === q.id);
      const state = active ? questProgressLine(q, active.progress, materialsRef.current) : '未受注';
      return { label: `${questChoiceTitle(q, candidates)}（${state}）`, onSelect: () => select(q) };
    });
    if (page > 0) choices.push({ label: '前へ', pinned: true, onSelect: () => showQuestChoices(npc, candidates, select, guild, page - 1, heading) });
    if (start + QUEST_CHOICES_PER_PAGE < candidates.length) choices.push({ label: '次へ', pinned: true, onSelect: () => showQuestChoices(npc, candidates, select, guild, page + 1, heading) });
    if (!guild) choices.push({ label: '話す', pinned: true, onSelect: () => {
      const alt = npcAltLineFor(npc, flagsRef.current, materialsRef.current);
      // 戦闘つきのセリフは読み終えたら一覧へ戻らず戦闘へ (D-STORY-009)。
      setNpcTalk({ npc, lines: alt?.lines ?? npc.lines, ...(alt?.battle ? { storyBattle: true } : { directList: true }) });
    } });
    choices.push({ label: '戻る', pinned: true, onSelect: () => setNpcTalk(guild ? guildReception(npc) : null) });
    const pages = Math.max(1, Math.ceil(candidates.length / QUEST_CHOICES_PER_PAGE));
    setNpcTalk({ npc, lines: [...lead, `${heading}（${page + 1}/${pages}）`], choices, ...(guild ? { guild: 'message' as const } : {}) });
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
      // 章の終わりの依頼で入れられる人数が増えたら知らせる (D-PARTY-001 §8)。
      const grown = !!res.flags && partyCapacity(res.flags) > partyCapacity(flagsRef.current);
      if (res.flags) flagsRef.current = res.flags;
      setServerPower(res.power);
      applyServerMaterials(res.materials);
      const r = res.rewarded;
      const got = [r?.itemId ? `${ITEMS[r.itemId]?.name ?? r.itemId} ×${r.count}` : null,
        r?.power ? `あおぞらパワー${r.power}` : null].filter(Boolean).join('と');
      // talk は相手のセリフ (いつものセリフの代わり) に続けて達成を出す (D-STORY-009)。
      const said = o.kind === 'talk' ? [o.line, `『${q.title}』を達成した！`] : q.done;
      message([...said, ...(got ? [`${got}をもらった！`] : [])], [...scenarioMessagesOf(res.scenarioMessages, res.notices), ...(grown ? [{ text: PARTY_LINES.grown }] : [])]);
    } catch (e) {
      try { await refreshQuestState(); } catch { /* Keep only the last confirmed snapshot. */ }
      if (questRef.current.done.includes(q.id)) message(['この依頼は達成済みだよ。']);
      else if (e instanceof WorldServerError && e.code === 'not_ready' && q.objective.kind !== 'talk') message([...(q.progress ?? []), e.message, 'そろったらまた報告してね。']);
      else message([e instanceof WorldServerError ? e.message : '通信に失敗した…もう一度報告してね。']);
    } finally {
      moveBusyRef.current = false;
      setQuestPending(false);
    }
  };

  const viewGuildQuest = (npc: NpcDef, q?: GameQuestDef) => {
    if (!q) {
      // 達成済みは出さない (一人一度の依頼。fb-1010)。0件なら紹介できる依頼なし。
      const candidates = guildBoardQuests(npc);
      if (!candidates.length) { guildMessage(npc, ['いま紹介できる依頼はないよ。']); return; }
      if (candidates.length > 1) { showQuestChoices(npc, candidates, selected => viewGuildQuest(npc, selected), true); return; }
      q = candidates[0]!;
    }
    const lines = guildQuestDetailLines(q);
    const active = questRef.current.activeQuests.find(a => a.id === q.id);
    if (active) guildMessage(npc, [...lines, questProgressLine(q, active.progress, materialsRef.current), 'そろったら「報告する」を選んでね。']);
    else setNpcTalk({ npc, guild: 'detail', lines: [...lines, 'うけますか？'], acceptQuestId: q.id });
  };
  const reportGuildQuest = (npc: NpcDef) => {
    const candidates = guildReportQuests(npc);
    if (!candidates.length) { guildMessage(npc, ['いま報告できる受注中の依頼はないよ。']); return; }
    // 1件でも一覧から選ぶ。選んだら説明・確認なしで報告する (未達はサーバーの不足表示)。
    showQuestChoices(npc, candidates, q => reportQuest(npc, q, true), true, 0, 'どの依頼を報告する？');
  };
  /** guild = 受付の「話す」の続き (読み終えたら受付のメニューへ戻る)。lead = 先に話すセリフ。 */
  const selectDirectQuest = (npc: NpcDef, q: GameQuestDef, directList: boolean, guild = false, lead: readonly string[] = []) => {
    const active = questRef.current.activeQuests.find(a => a.id === q.id);
    const at = guild ? { guild: 'message' as const } : { directList };
    // talk の報告先は相手の NPC (openDirectNpc)。依頼主には進み具合だけ話す。
    if (active && q.objective.kind === 'talk') setNpcTalk({ npc, lines: [...lead, ...(q.progress ?? ['たのんだよ。']), questProgressLine(q, active.progress, materialsRef.current)], ...at });
    else if (active) return reportQuest(npc, q, guild, directList);
    else setNpcTalk({ npc, lines: [...lead, ...questOfferLines(q)], acceptQuestId: q.id, ...at });
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

  // パーティ (D-PARTY-001): 権威 state の party と flags を読む / 編成を送る。編成画面とメニューの「なかま」が使う。
  const partyLoad = useCallback(async () => {
    if (!agent) throw new Error('サーバーに接続できない');
    const { state } = await serverState(agent);
    if (state.flags) flagsRef.current = state.flags;
    setParty(state.party ?? { ids: [] });
    return { party: state.party ?? { ids: [] }, flags: state.flags ?? [] };
  }, [agent, flagsRef]);
  const partySave = useCallback(async (guild: string, ids: string[], payRkey?: string) => {
    if (!agent) throw new Error('サーバーに接続できない');
    const r = await serverPartySet(agent, guild, ids, tokenRef.current, payRkey);
    setParty(r.party);
    setServerPower(r.power);
    return r;
  }, [agent, tokenRef, setServerPower]);
  const partyCandidates = useCallback(async (guild: string) => {
    if (!agent) throw new Error('サーバーに接続できない');
    return serverPartyCandidates(agent, guild, tokenRef.current);
  }, [agent, tokenRef]);
  const partyReroll = useCallback(async (guild: string, rkey: string) => {
    if (!agent) throw new Error('サーバーに接続できない');
    const r = await serverPartyReroll(agent, guild, rkey, tokenRef.current);
    setServerPower(r.power);
    return r;
  }, [agent, tokenRef, setServerPower]);
  // 受付を開いたら仲間の HP を読み直しておく。「話す」は通信を待たずに、読めている party で宿屋をすすめる。
  const guildNpcId = npcTalk?.guild ? npcTalk.npc.id : null;
  useEffect(() => {
    if (guildNpcId && agent) partyLoad().catch(() => { /* 読めなければ前の party のまま */ });
  }, [guildNpcId, agent, partyLoad]);

  /** 受付の「話す」。倒れた仲間がいれば宿屋をすすめる (D-PARTY-001 §8)。続けて受付の人の個人の頼みごと
   *  (personal) を、直接話す NPC と同じ流れで頼む (話の続きなので「依頼を見る」には出さない)。 */
  const guildTalk = (npc: NpcDef) => {
    const said = npcLinesFor(npc, flagsRef.current, materialsRef.current);
    const hurt = Object.values(party.hp ?? {}).some((hp) => hp <= 0);
    const lines = hurt ? [PARTY_LINES.hurt, ...said] : said;
    const personal = npcQuests(npc).filter(q => q.personal);
    const only = personal.length === 1 ? personal[0]! : undefined;
    // 報告は選んでから (話しただけで報告を送らない)。受注中で報告できるものは一覧から選ぶ。
    if (only && !(isActive(only) && only.objective.kind !== 'talk')) selectDirectQuest(npc, only, false, true, lines);
    else if (personal.length) showQuestChoices(npc, personal, q => selectDirectQuest(npc, q, false, true), true, 0, undefined, lines);
    else guildMessage(npc, lines);
  };

  let npcChoices: DialogueChoice[] | undefined = npcTalk?.choices;
  if (npcTalk?.guild === 'menu') {
    const npc = npcTalk.npc;
    // ガチャ (D-PARTY-002) ではどのギルドにも毎日 冒険者が来る。切ったとき (§6) は名前つきの冒険者がいるときだけ。
    const canParty = partyCapacity(flagsRef.current) > 1 && (RECRUIT_GACHA.enabled || recruits().length > 0);
    const offerable = guildBoardQuests(npc).filter(q => !isActive(q)).length;
    const reportable = guildReportQuests(npc).length;
    npcChoices = [
      { label: offerable ? `依頼を見る(${offerable})` : '依頼を見る', onSelect: () => viewGuildQuest(npc) },
      { label: reportable ? `報告する(${reportable})` : '報告する', onSelect: () => reportGuildQuest(npc) },
      ...(canParty ? [{ label: 'なかまを さがす', onSelect: () => setNpcTalk({ npc, guild: 'party', lines: [] }) }] : []),
      { label: '話す', onSelect: () => guildTalk(npc) },
      { label: 'やめる', onSelect: () => { waitForFreshDirectionRef.current = true; setNpcTalk(null); } },
    ];
  } else if (npcTalk?.guild === 'detail' && npcTalk.acceptQuestId) {
    const { npc, acceptQuestId } = npcTalk;
    npcChoices = [
      { label: '受注する', onSelect: async () => {
        try {
          if (await acceptQuest(acceptQuestId)) return;
          guildMessage(npc, [`『${gameQuestById(acceptQuestId)?.title ?? acceptQuestId}』を請け負った！`, 'そろったらギルドで報告してね。']);
        } catch (e) {
          guildMessage(npc, [e instanceof WorldServerError ? e.message : '通信に失敗した…もう一度確かめてね。']);
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

  return { npcTalk, setNpcTalk, npcTalkRef, quest, setQuest, questPending, npcChoices, openDirectNpc, directQuestList, startStoryBattle, partyLoad, partySave, partyCandidates, partyReroll, party, setParty };
}
