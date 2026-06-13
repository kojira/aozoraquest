import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useSession } from '@/lib/session';
import { fetchPosts, listNotifications, updateNotificationsSeen } from '@/lib/atproto';
import { useInfiniteFeed } from '@/lib/use-infinite-feed';
import { VirtualFeed } from '@/components/virtual-feed';
import { NotificationItem } from '@/components/notification-item';
import { useColumnScrollEl } from '@/components/column-scroll-context';
import {
  groupNotifications,
  postUrisForGroups,
  type NotifGroup,
  type Notification,
} from '@/lib/notifications';

/** 通知ページ (route)。中身は NotificationsFeed (workspace カラムと共用)。
 *  既読化 (markSeen) はこのページを開いたときだけ発火する。 */
export function Notifications() {
  return (
    <div>
      <h2>通知</h2>
      <NotificationsFeed markSeen />
    </div>
  );
}

/**
 * 通知フィード本体: listNotifications でページングしつつ、グループ単位で表示。
 * - markSeen=true (通知ページ) は初回ロード後に updateNotificationsSeen を
 *   発火 (未読バッジをクリア)
 * - markSeen=false (workspace カラム) は **このフィードが画面に 50% 以上
 *   見えたとき** に既読化する。`/` を開いただけ (= カラムが画面外) では
 *   未読バッジが死なない
 * - 各ページ分の関連投稿 URI をまとめて getPosts で取得し、Map にキャッシュ
 * - グルーピングはページ単位ではなく **全 items の連結** に対して再計算
 *   (ページ境界で連続マージが成り立つように)
 */
export function NotificationsFeed({ markSeen = false }: { markSeen?: boolean }) {
  const session = useSession();
  const scrollEl = useColumnScrollEl();
  const rootRef = useRef<HTMLDivElement>(null);
  // カラムモードの可視判定: 50% 以上見えたら markSeen 相当に切り替える
  const [visibleSeen, setVisibleSeen] = useState(false);
  useEffect(() => {
    if (markSeen || visibleSeen) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisibleSeen(true);
      },
      { threshold: [0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [markSeen, visibleSeen]);
  const shouldMarkSeen = markSeen || visibleSeen;
  const agent = session.agent;
  const seenSent = useRef(false);
  const [postCache, setPostCache] = useState<Map<string, AppBskyFeedDefs.PostView>>(
    () => new Map(),
  );

  const feed = useInfiniteFeed<Notification>({
    enabled: session.status === 'signed-in' && !!agent,
    keyOf: (n) => n.uri,
    deps: [session.status, agent],
    fetchPage: async (cursor) => {
      if (!agent) return { items: [] };
      const data = await listNotifications(agent, cursor);
      return {
        items: data.notifications,
        ...(data.cursor !== undefined ? { cursor: data.cursor } : {}),
      };
    },
  });

  // 初回 items 取得後に updateSeen を fire-and-forget
  // (通知ページ、またはカラムが可視になったとき)
  useEffect(() => {
    if (!shouldMarkSeen || !agent) return;
    if (seenSent.current) return;
    if (feed.items.length === 0 && !feed.done) return;
    seenSent.current = true;
    void updateNotificationsSeen(agent);
  }, [shouldMarkSeen, agent, feed.items.length, feed.done]);

  const groups = useMemo(() => groupNotifications(feed.items), [feed.items]);

  // items の増分に応じて必要な post URI を fetchPosts
  useEffect(() => {
    if (!agent) return;
    const needed = postUrisForGroups(groups).filter((u) => !postCache.has(u));
    if (needed.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const posts = await fetchPosts(agent, needed);
        if (cancelled) return;
        setPostCache((prev) => {
          const next = new Map(prev);
          for (const p of posts) next.set(p.uri, p);
          return next;
        });
      } catch (e) {
        console.warn('[notifications] fetchPosts failed', e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, groups]);

  return (
    <div ref={rootRef}>
      {feed.err && (
        <p style={{ color: 'var(--color-danger)' }}>うまく読み込めませんでした: {feed.err}</p>
      )}
      {!feed.loading && groups.length === 0 && !feed.err && (
        <p style={{ color: 'var(--color-muted)' }}>通知はまだありません。</p>
      )}
      <VirtualFeed<NotifGroup>
        items={groups}
        keyOf={(g) => g.id}
        estimateSize={220}
        scrollParent={scrollEl}
        renderItem={(g) => <NotificationItem group={g} postCache={postCache} />}
        onEndReached={feed.done ? undefined : feed.loadMore}
        footer={
          <>
            {feed.loading && <p style={{ textAlign: 'center' }}>読み込み中…</p>}
            {feed.done && groups.length > 0 && (
              <p style={{ textAlign: 'center', fontSize: '0.8em', color: 'var(--color-muted)' }}>
                これ以上はありません。
              </p>
            )}
          </>
        }
      />
    </div>
  );
}
