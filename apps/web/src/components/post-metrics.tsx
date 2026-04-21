import { HeartIcon, RepeatIcon, ReplyIcon } from './icons';

interface PostMetricsProps {
  likeCount?: number | undefined;
  repostCount?: number | undefined;
  replyCount?: number | undefined;
}

/**
 * 投稿カード下部の いいね / リポスト / リプライ 数。
 * マテリアル系の線画アイコン + 数字。
 */
export function PostMetrics({ likeCount, repostCount, replyCount }: PostMetricsProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '1.1em',
        alignItems: 'center',
        fontSize: '0.78em',
        color: 'var(--color-muted)',
        marginTop: '0.5em',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3em' }}>
        <HeartIcon size={15} /> {likeCount ?? 0}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3em' }}>
        <RepeatIcon size={15} /> {repostCount ?? 0}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3em' }}>
        <ReplyIcon size={15} /> {replyCount ?? 0}
      </span>
    </div>
  );
}
