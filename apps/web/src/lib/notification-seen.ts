/**
 * 「通知を既読化した」ことを app 全体に知らせる軽量シグナル (visible-column と同じ pattern)。
 *
 * NotificationsFeed が updateSeen を撃った (= 実際にサーバへ既読を送った、dwell 判定済み) 直後に
 * publish し、AppShell が subscribe して未読バッジ (赤ポッチ) を即 0 にする。
 *
 * これが無いと、モバイルで通知を**カラム (swipe, pathname は '/')** で見たとき、AppShell の
 * ローカル未読は `/notifications` ルートでしか消えず、次の 60 秒 poll まで赤ポッチが残る
 * (= 「見ても消えない」体感)。ルートに依らずカラム閲覧でも即消すためのイベント。
 */
const subscribers = new Set<() => void>();

/** 既読化した (updateSeen 済み)。購読者 (AppShell) にバッジ 0 を促す。 */
export function publishNotificationsSeen(): void {
  for (const fn of subscribers) {
    try { fn(); } catch { /* no-op */ }
  }
}

export function subscribeNotificationsSeen(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}
