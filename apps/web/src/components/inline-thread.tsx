import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppBskyFeedDefs } from '@atproto/api';
import { AppBskyFeedDefs as FeedDefs } from '@atproto/api';
import { useSession } from '@/lib/session';
import { fetchPostThread } from '@/lib/atproto';
import { ThreadReply } from './thread-reply';
import { PostArticle } from './post-article';
import { postDetailPath } from '@/lib/uri';

/**
 * タイムラインで投稿カードの下にインライン展開されるコンパクトスレッド。
 * 親 1 段 (即親) + 返信 depth=3 の軽め設定。親は **展開エリア内の上部** に
 * 「返信元」ブロックとして出す (カードより上に追加するとスクロール位置が
 * ジャンプするため)。取り切れない場合は「詳細で全て見る」リンク。
 */
const INLINE_DEPTH = 3;
const INLINE_PARENT = 1;

type ThreadNode =
  | AppBskyFeedDefs.ThreadViewPost
  | AppBskyFeedDefs.NotFoundPost
  | AppBskyFeedDefs.BlockedPost
  | { $type?: string };

export function InlineThread({
  postUri,
  authorHandle,
}: {
  postUri: string;
  authorHandle: string;
}) {
  const session = useSession();
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    parent?: ThreadNode | undefined;
    replies?: ThreadNode[];
    error?: string;
  }>({ status: 'loading' });

  useEffect(() => {
    if (!session.agent) return;
    const agent = session.agent;
    let cancelled = false;
    (async () => {
      try {
        const thread = await fetchPostThread(agent, postUri, {
          depth: INLINE_DEPTH,
          parentHeight: INLINE_PARENT,
        });
        if (cancelled) return;
        if (FeedDefs.isThreadViewPost(thread)) {
          setState({
            status: 'ready',
            parent: thread.parent,
            replies: thread.replies ?? [],
          });
        } else {
          setState({ status: 'error', error: 'スレッドを取得できませんでした' });
        }
      } catch (e) {
        if (cancelled) return;
        setState({ status: 'error', error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => { cancelled = true; };
  }, [postUri, session.agent]);

  const detailPath = postDetailPath(authorHandle, postUri);

  return (
    <div
      style={{
        marginTop: '0.6em',
        borderTop: '1px dashed var(--color-border)',
        paddingTop: '0.6em',
      }}
    >
      {state.status === 'loading' && (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>スレッドを読み込み中…</p>
      )}
      {state.status === 'error' && (
        <p style={{ fontSize: '0.85em', color: 'var(--color-danger)' }}>
          {state.error ?? 'エラーが発生しました'}
        </p>
      )}
      {state.status === 'ready' && (
        <>
          {state.parent && (
            <div style={{ marginBottom: '0.6em' }}>
              <div style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>
                ↪ 返信元
              </div>
              <div style={{ opacity: 0.85, borderLeft: '2px solid var(--color-border)', paddingLeft: 10 }}>
                <ParentPreview node={state.parent} />
              </div>
            </div>
          )}
          {state.replies && state.replies.length > 0 ? (
            state.replies.map((r, i) => (
              <ThreadReply key={replyKey(r, i)} node={r} depth={1} />
            ))
          ) : (
            !state.parent && (
              <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>まだ返信はありません。</p>
            )
          )}
          <div style={{ textAlign: 'right', marginTop: '0.6em' }}>
            <Link to={detailPath} style={{ fontSize: '0.85em' }}>
              全て見る →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function ParentPreview({ node }: { node: ThreadNode }) {
  if (FeedDefs.isThreadViewPost(node)) {
    return <PostArticle post={node.post} />;
  }
  if (FeedDefs.isNotFoundPost(node)) {
    return (
      <p style={{ fontStyle: 'italic', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        削除された投稿
      </p>
    );
  }
  if (FeedDefs.isBlockedPost(node)) {
    return (
      <p style={{ fontStyle: 'italic', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        ブロックされた投稿
      </p>
    );
  }
  return null;
}

function replyKey(
  n: AppBskyFeedDefs.ThreadViewPost | AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type?: string },
  i: number,
): string {
  if (FeedDefs.isThreadViewPost(n)) return n.post.uri;
  if (FeedDefs.isNotFoundPost(n) || FeedDefs.isBlockedPost(n)) return n.uri;
  return `reply-${i}`;
}
