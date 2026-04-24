import { useState, useCallback } from 'react';
import type { AppBskyFeedDefs } from '@atproto/api';
import { AppBskyFeedDefs as FeedDefs } from '@atproto/api';
import { useSession } from '@/lib/session';
import { fetchPostThread } from '@/lib/atproto';
import { PostArticle } from './post-article';
import { ThreadReply } from './thread-reply';
import { NotFoundOrBlockedPlaceholder } from './thread-placeholders';

type ThreadNode =
  | AppBskyFeedDefs.ThreadViewPost
  | AppBskyFeedDefs.NotFoundPost
  | AppBskyFeedDefs.BlockedPost
  | { $type?: string };

/**
 * スレッド全体 (親チェーン + 当該投稿 + 返信) を描画する。
 * - parent: 再帰的に上方向を root までたどって逆順 (上→下)
 * - target: highlight=true で中央に
 * - replies: 再帰的に下方向
 * highlight は「当該投稿」。
 */
export function ThreadView({
  thread,
  highlightUri,
  onRefetchWithParentHeight,
  fetchingMoreParents,
}: {
  thread: AppBskyFeedDefs.ThreadViewPost;
  highlightUri: string;
  onRefetchWithParentHeight?: () => void;
  fetchingMoreParents?: boolean;
}) {
  const parents = collectParents(thread.parent);
  const canLoadMoreParents = Boolean(onRefetchWithParentHeight) && hasMoreParents(thread, parents);

  return (
    <div>
      {canLoadMoreParents && (
        <div style={{ textAlign: 'center', margin: '0.6em 0' }}>
          <button
            type="button"
            disabled={!!fetchingMoreParents}
            onClick={onRefetchWithParentHeight}
            style={{ fontSize: '0.85em' }}
          >
            {fetchingMoreParents ? '読み込み中…' : 'さらに上の投稿を読み込む'}
          </button>
        </div>
      )}
      {parents.map((node, i) => (
        <ThreadParentNode key={parentKey(node, i)} node={node} />
      ))}
      <PostArticle post={thread.post} highlight={thread.post.uri === highlightUri} />
      {thread.replies?.map((r, i) => (
        <ThreadReply key={replyKey(r, i)} node={r} depth={0} />
      ))}
    </div>
  );
}

function ThreadParentNode({ node }: { node: ThreadNode }) {
  if (FeedDefs.isThreadViewPost(node)) {
    return (
      <div style={{ borderLeft: '2px solid var(--color-border)', paddingLeft: 10, opacity: 0.85 }}>
        <PostArticle post={node.post} />
      </div>
    );
  }
  if (FeedDefs.isNotFoundPost(node) || FeedDefs.isBlockedPost(node)) {
    return <NotFoundOrBlockedPlaceholder node={node} />;
  }
  return null;
}

function collectParents(node: ThreadNode | undefined): ThreadNode[] {
  // root → ... → 当該の親、の順に並べた配列を返す
  const chain: ThreadNode[] = [];
  let cur: ThreadNode | undefined = node;
  while (cur) {
    chain.push(cur);
    if (FeedDefs.isThreadViewPost(cur)) {
      cur = cur.parent;
    } else {
      cur = undefined;
    }
  }
  return chain.reverse();
}

function hasMoreParents(thread: AppBskyFeedDefs.ThreadViewPost, parents: ThreadNode[]): boolean {
  // record.reply.root が現在の投稿自身でない && チェーンの最上位が root でない
  // = 途中で途切れている可能性がある
  const record = thread.post.record as { reply?: { root?: { uri?: string } } } | undefined;
  const rootUri = record?.reply?.root?.uri;
  if (!rootUri || rootUri === thread.post.uri) return false;
  const top = parents[0];
  if (!top) {
    // 親チェーンがまだ 1 つも無いのに reply.root が別 URI → 省略されている
    return true;
  }
  if (FeedDefs.isThreadViewPost(top)) {
    return top.post.uri !== rootUri;
  }
  // notFound / blocked が最上位なら、その上に root があるはず
  return true;
}

function parentKey(n: ThreadNode, i: number): string {
  if (FeedDefs.isThreadViewPost(n)) return n.post.uri;
  if (FeedDefs.isNotFoundPost(n) || FeedDefs.isBlockedPost(n)) return n.uri;
  return `parent-${i}`;
}

function replyKey(n: ThreadNode, i: number): string {
  if (FeedDefs.isThreadViewPost(n)) return n.post.uri;
  if (FeedDefs.isNotFoundPost(n) || FeedDefs.isBlockedPost(n)) return n.uri;
  return `reply-${i}`;
}

/** 詳細ページで使う state 付きラッパ: 親 fetch 再試行や branch 差し替えを面倒見る。 */
export function ThreadViewContainer({
  initialThread,
  uri,
}: {
  initialThread: AppBskyFeedDefs.ThreadViewPost;
  uri: string;
}) {
  const session = useSession();
  const [thread, setThread] = useState(initialThread);
  const [busy, setBusy] = useState(false);

  const refetchWithMoreParents = useCallback(async () => {
    if (!session.agent) return;
    setBusy(true);
    try {
      const next = await fetchPostThread(session.agent, uri, { depth: 6, parentHeight: 80 });
      if (FeedDefs.isThreadViewPost(next)) setThread(next);
    } catch (e) {
      console.warn('[thread] refetch more parents failed', e);
    } finally {
      setBusy(false);
    }
  }, [session.agent, uri]);

  return (
    <ThreadView
      thread={thread}
      highlightUri={uri}
      onRefetchWithParentHeight={refetchWithMoreParents}
      fetchingMoreParents={busy}
    />
  );
}
