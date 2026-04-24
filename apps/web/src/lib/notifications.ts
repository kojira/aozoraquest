/**
 * 通知の集約 / URI 抽出ヘルパ。
 *
 * Bluesky の listNotifications は 1 アクション 1 行で降ってくるので、同じ
 * 対象への連続した反応 (複数人がいいね、複数人がフォロー等) はクライアント側で
 * まとめないと like 爆撃で通知欄が埋まる。
 */

import type { AppBskyNotificationListNotifications } from '@atproto/api';

export type Notification = AppBskyNotificationListNotifications.Notification;

export interface NotifGroup {
  /** 代表 key: グループ内 1 件目の URI */
  id: string;
  reason: string;
  subjectUri?: string;
  authors: Notification['author'][];
  latestAt: string;
  /** true なら全員既読。false ならグループ内に未読あり。 */
  allRead: boolean;
  notifications: Notification[];
}

const GROUPABLE = new Set<string>([
  'like',
  'repost',
  'follow',
  'like-via-repost',
  'repost-via-repost',
]);

function subjectKey(n: Notification): string | undefined {
  if (typeof n.reasonSubject === 'string') return n.reasonSubject;
  // reply / mention / quote はユニーク key (束ねない)
  if (n.reason === 'reply' || n.reason === 'mention' || n.reason === 'quote') {
    return n.uri;
  }
  return undefined;
}

/**
 * 連続する run を (reason, subjectKey) でマージ。
 * - 異なる reason が挟まったら切る
 * - 既存の配列に append していくだけの O(n)
 */
export function groupNotifications(list: Notification[]): NotifGroup[] {
  const out: NotifGroup[] = [];
  for (const n of list) {
    const key = subjectKey(n);
    const last = out[out.length - 1];
    const canMerge =
      !!last &&
      last.reason === n.reason &&
      GROUPABLE.has(n.reason) &&
      (last.subjectUri ?? '') === (key ?? '');
    if (canMerge) {
      last.authors.push(n.author);
      last.notifications.push(n);
      if (!n.isRead) last.allRead = false;
      continue;
    }
    out.push({
      id: n.uri,
      reason: n.reason,
      ...(key ? { subjectUri: key } : {}),
      authors: [n.author],
      latestAt: n.indexedAt,
      allRead: n.isRead,
      notifications: [n],
    });
  }
  return out;
}

/** グループ一覧から、プレビューのためにまとめて fetchPosts すべき URI を列挙。 */
export function postUrisForGroups(groups: NotifGroup[]): string[] {
  const uris = new Set<string>();
  for (const g of groups) {
    const uri = previewUriForGroup(g);
    if (uri) uris.add(uri);
  }
  return [...uris];
}

/** 1 グループで表示したい投稿 URI (無いなら undefined)。 */
export function previewUriForGroup(g: NotifGroup): string | undefined {
  // like / repost 系: 反応された自分の投稿
  if (g.subjectUri && (g.reason === 'like' || g.reason === 'repost' ||
      g.reason === 'like-via-repost' || g.reason === 'repost-via-repost')) {
    return g.subjectUri;
  }
  // reply / mention / quote: 相手の投稿 (notification.uri が record URI)
  if (g.reason === 'reply' || g.reason === 'mention' || g.reason === 'quote') {
    return g.notifications[0]?.uri;
  }
  return undefined;
}

export function labelForReason(reason: string): string {
  switch (reason) {
    case 'like':
    case 'like-via-repost':
      return 'いいね';
    case 'repost':
    case 'repost-via-repost':
      return 'リポスト';
    case 'follow':
      return 'フォロー';
    case 'mention':
      return 'メンション';
    case 'reply':
      return '返信';
    case 'quote':
      return '引用';
    case 'starterpack-joined':
      return 'スターターパック参加';
    default:
      return reason;
  }
}
