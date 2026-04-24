import type { AppBskyFeedDefs } from '@atproto/api';
import { AppBskyFeedDefs as FeedDefs } from '@atproto/api';

/**
 * notFound / blocked の投稿を、スレッドの連続性を保つためのプレースホルダとして描画。
 */
export function NotFoundOrBlockedPlaceholder({
  node,
}: {
  node: AppBskyFeedDefs.NotFoundPost | AppBskyFeedDefs.BlockedPost | { $type?: string };
}) {
  const label = FeedDefs.isNotFoundPost(node)
    ? '削除された投稿'
    : FeedDefs.isBlockedPost(node)
      ? 'ブロックされた投稿'
      : '読み込めない投稿';
  return (
    <div
      className="dq-window"
      style={{
        opacity: 0.6,
        fontStyle: 'italic',
        color: 'var(--color-muted)',
        fontSize: '0.85em',
      }}
    >
      {label}
    </div>
  );
}
