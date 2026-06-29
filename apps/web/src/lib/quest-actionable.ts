/**
 * 「自分のアクション待ちクエスト件数」を app 全体で共有する軽量ストア。
 *
 * 発注者の承認待ち (pendingApproval) + 受託者の完了報告待ち (reportPending) の合計を
 * useBoardData が publish し、footer-nav の「クエスト」タブが赤カウントバッジで表示する。
 * @mention 通知を見逃しても、未対応が残っていれば常にバッジで気付ける (= 通知に依存しない)。
 *
 * 件数は完了集合/ completion record からの派生なので、ユーザーが承認/報告すると自然に減る
 * (バッジを「既読」でリセットはしない = 実際の未対応状態を映す)。
 */
import { useSyncExternalStore } from 'react';

let count = 0;
const subscribers = new Set<() => void>();

export function setQuestActionableCount(n: number): void {
  if (n === count) return;
  count = n;
  for (const s of subscribers) {
    try { s(); } catch { /* no-op */ }
  }
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

function getSnapshot(): number {
  return count;
}

/** footer-nav 等が購読するフック。アクション待ち件数を返す。 */
export function useQuestActionableCount(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
