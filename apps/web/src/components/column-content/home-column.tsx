/**
 * home カラム: 自分のフォロー TL (旧 routes/home.tsx の「フォロー」タブを移設)。
 *
 * HomeSummary (自分のレーダー + 日次サマリ) + フォロー TL。
 * (投稿ボタンは AppShell のフローティング FAB に移設済み)
 * VirtualFeed は ColumnScrollContext 経由でカラム内スクロールに切り替わる。
 * 自分の診断は use-self-diagnosis の共有キャッシュから取る (bar と重複
 * fetch しない / 投稿後の refresh が bar にも伝播する)。
 */
import { useEffect, useMemo, useState } from 'react';
import type { AppBskyFeedDefs } from '@atproto/api';
import type { Archetype, StatVector } from '@aozoraquest/core';
import { JOBS_BY_ID, statArrayToVector } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { fetchTimeline, getRecord } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import { useInfiniteFeed } from '@/lib/use-infinite-feed';
import { loadCachedTLPage, saveCachedTLPage } from '@/lib/tl-cache-idb';
import { useSelfDiagnosis, refreshSelfDiagnosis } from '@/lib/use-self-diagnosis';
import { VirtualFeed } from '@/components/virtual-feed';
import { HomeSummary } from '@/components/home-summary';
import { PostArticle } from '@/components/post-article';
import { useOnPosted } from '@/components/compose-modal';
import { useArchetypes } from '@/lib/archetype-cache';
import { getHideReposts } from '@/lib/prefs';
import { useColumnScrollEl } from '@/components/column-scroll-context';

export function HomeColumn() {
  const session = useSession();
  const scrollEl = useColumnScrollEl();
  const { diag: selfDiag } = useSelfDiagnosis();
  const [targetJob, setTargetJob] = useState<Archetype | null>(null);

  const agent = session.agent;

  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !session.did) return;
    getRecord<{ targetJob?: string }>(agent, session.did, COL.profile, 'self')
      .then((p) => {
        if (p?.targetJob && p.targetJob in JOBS_BY_ID) setTargetJob(p.targetJob as Archetype);
      })
      .catch((e) => console.warn('profile load failed', e));
  }, [session.status, agent, session.did]);

  const targetStats: StatVector | null = useMemo(
    () => (targetJob ? statArrayToVector(JOBS_BY_ID[targetJob].stats) : null),
    [targetJob],
  );

  // フォロー TL: カーソル無限スクロール + IDB SWR キャッシュ
  const followingCacheKey = session.did ? `tl:following:${session.did}` : null;
  const followingFeed = useInfiniteFeed<AppBskyFeedDefs.FeedViewPost>({
    enabled: session.status === 'signed-in' && !!agent,
    keyOf: (x) => x.post.uri,
    deps: [session.status, agent],
    fetchPage: async (cursor) => {
      if (!agent) return { items: [] };
      const res = await fetchTimeline(agent, cursor);
      return {
        items: res.data.feed,
        ...(res.data.cursor !== undefined ? { cursor: res.data.cursor } : {}),
      };
    },
    ...(followingCacheKey
      ? {
          cache: {
            load: () => loadCachedTLPage<AppBskyFeedDefs.FeedViewPost>(followingCacheKey),
            save: (items) => saveCachedTLPage(followingCacheKey, items),
          },
        }
      : {}),
  });

  // 自分が投稿した直後に TL をリフレッシュ (反映ラグがあるので少し待つ)。
  // 診断の更新は共有キャッシュ経由なので bar カラムにも伝播する。
  useOnPosted(() => {
    setTimeout(() => followingFeed.refresh(), 500);
    if (agent && session.did) {
      const a = agent;
      const d = session.did;
      setTimeout(() => { void refreshSelfDiagnosis(a, d); }, 400);
    }
  });

  // 設定でリポスト非表示 ON の場合、reasonRepost 付きの item を除外
  const hideReposts = getHideReposts();
  const followingItems = useMemo(
    () =>
      hideReposts
        ? followingFeed.items.filter(
            (it) =>
              (it.reason as { $type?: string } | undefined)?.$type !== 'app.bsky.feed.defs#reasonRepost',
          )
        : followingFeed.items,
    [followingFeed.items, hideReposts],
  );

  const followingAuthorDids = useMemo(
    () => followingItems.map((it) => it.post.author.did),
    [followingItems],
  );
  const followingArchetypes = useArchetypes(agent ?? null, followingAuthorDids);

  if (session.status !== 'signed-in') {
    return <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>サインインするとフォロー TL が表示されます。</p>;
  }

  return (
    <div>
      {session.did && <HomeSummary agent={agent ?? null} diag={selfDiag} userDid={session.did} targetStats={targetStats} />}

      <section style={{ marginTop: '0.8em' }}>
        {followingFeed.err && <p style={{ color: 'var(--color-danger)' }}>うまく読み込めませんでした: {followingFeed.err}</p>}
        {!followingFeed.loading && followingItems.length === 0 && !followingFeed.err && (
          <p style={{ color: 'var(--color-muted)' }}>タイムラインが空です。</p>
        )}
        <VirtualFeed
          items={followingItems}
          keyOf={(x) => x.post.uri}
          scrollParent={scrollEl}
          {...(followingCacheKey ? { heightCacheKey: followingCacheKey } : {})}
          renderItem={(item) => (
            <PostCard item={item} archetype={followingArchetypes.get(item.post.author.did) ?? null} />
          )}
          onEndReached={followingFeed.done ? undefined : followingFeed.loadMore}
          footer={
            <>
              {followingFeed.loading && <p style={{ textAlign: 'center' }}>読み込み中...</p>}
              {followingFeed.done && followingItems.length > 0 && (
                <p style={{ textAlign: 'center', fontSize: '0.8em', color: 'var(--color-muted)' }}>
                  これ以上はありません。
                </p>
              )}
            </>
          }
        />
      </section>
    </div>
  );
}

function PostCard({ item, archetype }: { item: AppBskyFeedDefs.FeedViewPost; archetype?: Archetype | null }) {
  const reason = item.reason as { $type?: string; by?: AppBskyFeedDefs.FeedViewPost['post']['author'] } | undefined;
  const repostedBy =
    reason?.$type === 'app.bsky.feed.defs#reasonRepost' && reason.by ? reason.by : undefined;
  return (
    <PostArticle
      post={item.post}
      archetype={archetype ?? null}
      expandable
      hideHandle
      {...(repostedBy ? { repostedBy } : {})}
    />
  );
}
