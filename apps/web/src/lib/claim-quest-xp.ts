/**
 * 依頼クエストの完了 XP を権威 state に申告する (#534 / #533)。
 *
 * 投稿とデイリークエストの XP は post-processor が投稿のたびに申告するが、依頼クエストは
 * **発注者が承認した時点で確定する**ので、投稿とは別の入口が要る。承認を観測できるのは
 * 受託者のクライアントなので、完了クエストを読んだタイミングで申告する。
 *
 * 冪等キーは**クエストの URI**。同じクエストで二重に XP が入らないことはサーバーが保証する
 * (直近 200 件のリング)。ここでの localStorage 記録は**通信量を減らすためだけ**のもので、
 * 消えても正しさは壊れない (サーバー側で弾かれる)。
 */
import type { Agent } from '@atproto/api';
import { XP_REWARDS } from '@aozoraquest/core';
import { serverClaimXp, worldServerEnabled } from './world-server';
import { refreshJobXp } from './use-job-xp';

const KEY = 'aq.questXpClaimed';
/** localStorage に覚えておく件数。増え続けないよう頭打ちにする。 */
const MAX_REMEMBERED = 500;
/** 1 回の呼び出しで投げる申告の上限。完了が大量にある人が /me を開いた瞬間に
 *  edge へ数百リクエスト投げないようにする (残りは次回に回る)。 */
const MAX_PER_CALL = 10;

function loadClaimed(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveClaimed(set: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set].slice(-MAX_REMEMBERED)));
  } catch { /* quota 超過等は無視 — サーバー側の冪等で正しさは保たれる */ }
}

/**
 * 完了した依頼クエストぶんの XP を申告する。best-effort (失敗しても投げっぱなし)。
 *
 * @param completedUris 自分が受託して**承認済み**のクエスト URI 一覧
 * @returns 実際に積まれた XP の合計
 */
export async function claimQuestXp(
  agent: Agent,
  did: string,
  archetype: string,
  completedUris: readonly string[],
): Promise<number> {
  if (!worldServerEnabled || !archetype || completedUris.length === 0) return 0;
  const claimed = loadClaimed();
  const todo = completedUris.filter((u) => !claimed.has(u)).slice(0, MAX_PER_CALL);
  if (todo.length === 0) return 0;

  let total = 0;
  for (const uri of todo) {
    try {
      const r = await serverClaimXp(agent, { kind: 'quest', archetype, xp: XP_REWARDS.questComplete, key: uri });
      total += r.granted;
      // duplicate でも「もう申告済み」なので覚える (次回スキップできる)
      claimed.add(uri);
    } catch (e) {
      console.warn('quest xp claim failed', uri, e);
      break; // 通信が死んでいるなら残りも失敗する。次回に回す
    }
  }
  saveClaimed(claimed);
  if (total > 0) void refreshJobXp(agent, did);
  return total;
}

/** テスト用: 申告済み記録を消す。 */
export function clearQuestXpClaimed(): void {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}
