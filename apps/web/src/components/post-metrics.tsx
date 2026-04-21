import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppBskyFeedDefs } from '@atproto/api';
import { useSession } from '@/lib/session';
import { HeartIcon, RepeatIcon, ReplyIcon } from './icons';

interface PostMetricsProps {
  post: AppBskyFeedDefs.PostView;
}

/**
 * 投稿カード下部。いいね/リポスト/リプライ。クリックで実際に AT Protocol 操作を行う。
 * - いいね: agent.like / agent.deleteLike をトグル
 * - リポスト: agent.repost / agent.deleteRepost をトグル
 * - リプライ: /compose にリプライ先を持たせて遷移
 */
export function PostMetrics({ post }: PostMetricsProps) {
  const session = useSession();
  const navigate = useNavigate();
  const agent = session.agent;

  const [likeUri, setLikeUri] = useState<string | undefined>(post.viewer?.like);
  const [repostUri, setRepostUri] = useState<string | undefined>(post.viewer?.repost);
  const [likeCount, setLikeCount] = useState<number>(post.likeCount ?? 0);
  const [repostCount, setRepostCount] = useState<number>(post.repostCount ?? 0);
  const [busy, setBusy] = useState<'' | 'like' | 'repost'>('');

  async function toggleLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!agent || busy) return;
    setBusy('like');
    const prevUri = likeUri;
    const prevCount = likeCount;
    // 楽観的更新
    if (prevUri) {
      setLikeUri(undefined);
      setLikeCount(prevCount - 1);
    } else {
      setLikeUri('pending');
      setLikeCount(prevCount + 1);
    }
    try {
      if (prevUri && prevUri !== 'pending') {
        await agent.deleteLike(prevUri);
      } else {
        const res = await agent.like(post.uri, post.cid);
        setLikeUri(res.uri);
      }
    } catch (err) {
      console.warn('like toggle failed', err);
      // 戻す
      setLikeUri(prevUri);
      setLikeCount(prevCount);
    } finally {
      setBusy('');
    }
  }

  async function toggleRepost(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!agent || busy) return;
    setBusy('repost');
    const prevUri = repostUri;
    const prevCount = repostCount;
    if (prevUri) {
      setRepostUri(undefined);
      setRepostCount(prevCount - 1);
    } else {
      setRepostUri('pending');
      setRepostCount(prevCount + 1);
    }
    try {
      if (prevUri && prevUri !== 'pending') {
        await agent.deleteRepost(prevUri);
      } else {
        const res = await agent.repost(post.uri, post.cid);
        setRepostUri(res.uri);
      }
    } catch (err) {
      console.warn('repost toggle failed', err);
      setRepostUri(prevUri);
      setRepostCount(prevCount);
    } finally {
      setBusy('');
    }
  }

  function onReply(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rec = post.record as { reply?: { root: { uri: string; cid: string } }; text?: string };
    const root = rec.reply?.root ?? { uri: post.uri, cid: post.cid };
    navigate('/compose', {
      state: {
        replyTo: {
          parent: { uri: post.uri, cid: post.cid },
          root,
          author: post.author.handle,
          text: rec.text ?? '',
        },
      },
    });
  }

  const liked = !!likeUri;
  const reposted = !!repostUri;

  return (
    <div style={{ display: 'flex', gap: '1em', alignItems: 'center', marginTop: '0.5em' }}>
      <MetricButton onClick={onReply} ariaLabel="返信" count={post.replyCount ?? 0}>
        <ReplyIcon size={15} />
      </MetricButton>
      <MetricButton onClick={toggleRepost} ariaLabel={reposted ? 'リポスト解除' : 'リポスト'} count={repostCount} active={reposted} activeColor="#4caf7d">
        <RepeatIcon size={15} />
      </MetricButton>
      <MetricButton onClick={toggleLike} ariaLabel={liked ? 'いいね解除' : 'いいね'} count={likeCount} active={liked} activeColor="#ff6b9a">
        <HeartIcon size={15} />
      </MetricButton>
    </div>
  );
}

function MetricButton({
  onClick,
  ariaLabel,
  count,
  children,
  active = false,
  activeColor,
}: {
  onClick: (e: React.MouseEvent) => void;
  ariaLabel: string;
  count: number;
  children: React.ReactNode;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3em',
        background: 'transparent',
        border: 'none',
        padding: '0.15em 0.3em',
        color: active && activeColor ? activeColor : 'var(--color-muted)',
        fontSize: '0.78em',
        cursor: 'pointer',
        boxShadow: 'none',
        borderRadius: 4,
        transition: 'color 120ms ease, background-color 120ms ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      {children}
      <span>{count}</span>
    </button>
  );
}
