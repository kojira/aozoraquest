import { useCallback, useState } from 'react';
import type { AppBskyFeedDefs } from '@atproto/api';
import { AppBskyFeedDefs as FeedDefs } from '@atproto/api';
import { useSession } from '@/lib/session';
import { fetchPostThread } from '@/lib/atproto';
import { PostArticle } from './post-article';
import { NotFoundOrBlockedPlaceholder } from './thread-placeholders';

type ThreadNode =
  | AppBskyFeedDefs.ThreadViewPost
  | AppBskyFeedDefs.NotFoundPost
  | AppBskyFeedDefs.BlockedPost
  | { $type?: string };

/**
 * スレッドの返信を再帰描画。depth に応じて左インデント + 連結ライン。
 * 末端で replyCount > 0 かつ replies が空の場合は「この枝をもっと見る」ボタン。
 */
const INDENT_PX = 16;
const MAX_VISUAL_DEPTH = 8; // これ以上はインデントを増やさず見切る

export function ThreadReply({ node, depth }: { node: ThreadNode; depth: number }) {
  if (FeedDefs.isNotFoundPost(node) || FeedDefs.isBlockedPost(node)) {
    return (
      <div style={wrapperStyle(depth)}>
        <NotFoundOrBlockedPlaceholder node={node} />
      </div>
    );
  }
  if (!FeedDefs.isThreadViewPost(node)) return null;
  return <ThreadReplyTree node={node} depth={depth} />;
}

function ThreadReplyTree({
  node,
  depth,
}: {
  node: AppBskyFeedDefs.ThreadViewPost;
  depth: number;
}) {
  const session = useSession();
  const [extraReplies, setExtraReplies] = useState<ThreadNode[] | null>(null);
  const [busy, setBusy] = useState(false);

  const localReplies = extraReplies ?? node.replies ?? [];
  const hasMoreBranch =
    !extraReplies &&
    (node.post.replyCount ?? 0) > 0 &&
    (!node.replies || node.replies.length === 0);

  const loadMoreBranch = useCallback(async () => {
    if (!session.agent) return;
    setBusy(true);
    try {
      const sub = await fetchPostThread(session.agent, node.post.uri, { depth: 6, parentHeight: 0 });
      if (FeedDefs.isThreadViewPost(sub)) {
        setExtraReplies(sub.replies ?? []);
      }
    } catch (e) {
      console.warn('[thread] load branch failed', e);
    } finally {
      setBusy(false);
    }
  }, [session.agent, node.post.uri]);

  return (
    <div style={wrapperStyle(depth)}>
      <PostArticle post={node.post} />
      {localReplies.map((r, i) => (
        <ThreadReply key={replyKey(r, i)} node={r} depth={depth + 1} />
      ))}
      {hasMoreBranch && (
        <div style={{ ...wrapperStyle(depth + 1), marginTop: '0.4em' }}>
          <button type="button" disabled={busy} onClick={loadMoreBranch} style={{ fontSize: '0.85em' }}>
            {busy ? '読み込み中…' : `この枝をもっと見る (${node.post.replyCount} 件)`}
          </button>
        </div>
      )}
    </div>
  );
}

function wrapperStyle(depth: number): React.CSSProperties {
  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH);
  return {
    marginLeft: visualDepth * INDENT_PX,
    borderLeft: depth > 0 ? '2px solid var(--color-border)' : undefined,
    paddingLeft: depth > 0 ? 8 : 0,
  };
}

function replyKey(n: ThreadNode, i: number): string {
  if (FeedDefs.isThreadViewPost(n)) return n.post.uri;
  if (FeedDefs.isNotFoundPost(n) || FeedDefs.isBlockedPost(n)) return n.uri;
  return `reply-${i}`;
}
