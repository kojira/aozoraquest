/**
 * 「自分のアクション待ちクエスト件数」を app 全体で共有する軽量ストア + 集計関数。
 *
 * 発注者の承認待ち (pendingApproval) + 受託者の完了報告待ち (reportPending) の合計を
 * footer-nav の「クエスト」タブが赤カウントバッジで表示する。@mention 通知を見逃しても、
 * 未対応が残っていればバッジで気付ける (= 通知に依存しない)。
 *
 * 件数の供給は 2 経路 (どちらも同じ値を書くので競合しても一致する):
 *  1. app-shell が computeQuestActionableCount をサインイン時 / 復帰(focus)時に呼ぶ。
 *     ルート非依存で、ホーム以外に直接着地してもバッジが出る (これが基準値)。
 *  2. board カラム / routes/board の useBoardData が、表示中はライブに publish する
 *     (承認/報告した直後に即減る)。
 * サインアウト時は app-shell が 0 にリセットする。
 *
 * 件数は completion record からの派生なので、ユーザーが承認/報告すると自然に減る
 * (バッジを「既読」でリセットはしない = 実際の未対応状態を映す)。
 */
import { useSyncExternalStore } from 'react';
import { listIssuedQuests, listCompletionsFor, buildQuestIndexViaDiscovery, type QuestIndexSummary } from './quest-api';
import { getQuestIndexCached } from './quest-index-cache';
import { effectiveStateForAssignee, needsRequesterApproval, questAssignees, type UserQuest } from '@aozoraquest/core';

type Agent = Parameters<typeof buildQuestIndexViaDiscovery>[0];
type Did = Parameters<typeof buildQuestIndexViaDiscovery>[1][number];

let count = 0;
const subscribers = new Set<() => void>();

export function setQuestActionableCount(n: number): void {
  if (n === count) return;
  count = n;
  for (const s of subscribers) {
    try { s(); } catch { /* no-op */ }
  }
}

/** 件数変化を購読する (useSyncExternalStore 用 / テスト用)。返り値で解除。 */
export function subscribeQuestActionable(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

/** 現在のアクション待ち件数 (snapshot)。 */
export function getQuestActionableSnapshot(): number {
  return count;
}

/** footer-nav 等が購読するフック。アクション待ち件数を返す。 */
export function useQuestActionableCount(): number {
  return useSyncExternalStore(subscribeQuestActionable, getQuestActionableSnapshot, getQuestActionableSnapshot);
}

/** QuestIndexSummary → UserQuest (board-shared と同じ最小変換。completion 判定に必要な分だけ)。 */
function summaryToQuest(s: QuestIndexSummary): UserQuest {
  const q: UserQuest = {
    uri: s.uri,
    did: s.did,
    title: s.title,
    body: '',
    tags: s.tags,
    visibility: 'public',
    status: s.status as UserQuest['status'],
    rewardPoints: s.rewardPoints,
    createdAt: s.createdAt,
    updatedAt: s.createdAt,
  };
  if (s.assignee !== undefined) q.assignee = s.assignee;
  if (s.assignees !== undefined) q.assignees = s.assignees;
  if (s.maxAssignees !== undefined) q.maxAssignees = s.maxAssignees;
  if (s.deadline !== undefined) q.deadline = s.deadline;
  return q;
}

/**
 * 「自分のアクション待ち件数」をルート非依存で集計する (useBoardData と同じ判定)。
 *  = 受託者として(再)完了報告する番 (IN_PROGRESS / REVISION_REQUESTED)
 *  + 発注者として承認する番 (needsRequesterApproval)。
 * index は getQuestIndexCached (TTL 30s) 経由なので board カラムと取得を共有する。
 */
export async function computeQuestActionableCount(
  agent: Agent,
  did: Did,
  directoryDids: Did[],
): Promise<number> {
  // 受託者視点: index から自分が受託中のものを拾い completion で effective state 判定。
  let reportPending = 0;
  try {
    const idx = await getQuestIndexCached(() => buildQuestIndexViaDiscovery(agent, directoryDids, did));
    const mine = idx.quests.filter((q) => questAssignees(q).includes(did) && q.status === 'assigned');
    await Promise.all(mine.map(async (s) => {
      const q = summaryToQuest(s);
      try {
        const comps = await listCompletionsFor(undefined, q);
        // 複数受託: 自分ぶんの状態だけ見る (他受託者の進行は無関係)。
        const st = effectiveStateForAssignee(q, comps, did);
        if (st === 'IN_PROGRESS' || st === 'REVISION_REQUESTED') reportPending += 1;
      } catch {
        // 失敗時は「報告する番」に倒す (見落とすより出して気づかせる。useBoardData と対称)
        reportPending += 1;
      }
    }));
  } catch {
    /* index 取得失敗時は受託側 0 のまま */
  }

  // 発注者視点: 自分の発注クエストのうち受託者の報告が来て未承認のもの。
  let pendingApproval = 0;
  try {
    const qs = await listIssuedQuests(agent, did);
    const candidates = qs.filter((q) => q.status === 'assigned');
    const checked = await Promise.all(candidates.map(async (q) => {
      try {
        const comps = await listCompletionsFor(undefined, q);
        return needsRequesterApproval(q, comps);
      } catch {
        return false;
      }
    }));
    pendingApproval = checked.filter(Boolean).length;
  } catch {
    /* 発注側取得失敗時は 0 のまま */
  }

  return reportPending + pendingApproval;
}
