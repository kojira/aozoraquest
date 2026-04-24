import { Link, useNavigate } from 'react-router-dom';
import type { AppBskyFeedDefs } from '@atproto/api';
import { Avatar } from './avatar';
import { PostArticle } from './post-article';
import {
  AtIcon,
  HeartIcon,
  PersonAddIcon,
  QuoteIcon,
  RepeatIcon,
  ReplyIcon,
} from './icons';
import { formatDateTime } from '@/lib/format-datetime';
import { postDetailPath } from '@/lib/uri';
import { labelForReason, previewUriForGroup, type NotifGroup } from '@/lib/notifications';

/**
 * 1 通知グループをカードで描画。
 * - 未読 (allRead=false) は左に accent 色のストライプ
 * - authors はアバターを最大 5 個 + 「他 N 人」
 * - reason に応じて icon / ラベル / プレビュー投稿が変わる
 * - グループ全体クリックで reason 別に適切な先へ遷移
 */
const MAX_AVATARS = 5;

function iconFor(reason: string) {
  switch (reason) {
    case 'like':
    case 'like-via-repost':
      return HeartIcon;
    case 'repost':
    case 'repost-via-repost':
      return RepeatIcon;
    case 'follow':
      return PersonAddIcon;
    case 'reply':
      return ReplyIcon;
    case 'mention':
      return AtIcon;
    case 'quote':
      return QuoteIcon;
    default:
      return HeartIcon;
  }
}

export function NotificationItem({
  group,
  postCache,
}: {
  group: NotifGroup;
  postCache: Map<string, AppBskyFeedDefs.PostView>;
}) {
  const navigate = useNavigate();
  const Icon = iconFor(group.reason);
  const label = labelForReason(group.reason);
  const previewUri = previewUriForGroup(group);
  const post = previewUri ? postCache.get(previewUri) : undefined;
  const primary = group.authors[0];
  if (!primary) return null;

  const onCardClick = (e: React.MouseEvent) => {
    // 子の Link / button が onClick stopPropagation しているのでここに来たら navigate
    if ((e.target as HTMLElement).closest('a,button')) return;
    if (group.reason === 'follow') {
      navigate(`/profile/${primary.handle}`);
      return;
    }
    if (post) {
      navigate(postDetailPath(post.author.handle, post.uri));
    }
  };

  const headerText = buildHeaderText(group);

  return (
    <article
      className="dq-window"
      onClick={onCardClick}
      style={{
        cursor: group.reason === 'follow' || post ? 'pointer' : 'default',
        ...(group.allRead ? {} : { borderLeft: '3px solid var(--color-accent)' }),
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5em',
          fontSize: '0.85em',
          color: 'var(--color-muted)',
          flexWrap: 'wrap',
        }}
      >
        <Icon size={18} style={{ color: 'var(--color-accent)' }} />
        <AuthorStack authors={group.authors} />
        <span>
          が<strong style={{ color: 'var(--color-fg)' }}>{label}</strong>しました
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace' }}>
          {formatDateTime(group.latestAt)}
        </span>
      </div>
      {headerText && (
        <p style={{ marginTop: '0.4em', fontSize: '0.85em', color: 'var(--color-muted)' }}>
          {headerText}
        </p>
      )}
      {group.reason === 'follow' ? (
        <FollowPreview author={primary} />
      ) : previewUri && post ? (
        <div style={{ marginTop: '0.5em' }}>
          <PostArticle post={post} avatarSize={32} />
        </div>
      ) : previewUri ? (
        <p style={{ marginTop: '0.5em', fontSize: '0.85em', color: 'var(--color-muted)', fontStyle: 'italic' }}>
          (投稿が見つかりません)
        </p>
      ) : null}
    </article>
  );
}

function AuthorStack({ authors }: { authors: NotifGroup['authors'] }) {
  const shown = authors.slice(0, MAX_AVATARS);
  const extra = authors.length - shown.length;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((a, i) => (
        <Link
          key={a.did}
          to={`/profile/${a.handle}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'inline-block',
            marginLeft: i === 0 ? 0 : -6,
            lineHeight: 0,
            border: '1.5px solid var(--color-window-bg, #000)',
            borderRadius: '50%',
          }}
          title={a.displayName || a.handle}
        >
          <Avatar src={a.avatar} size={20} archetype={null} />
        </Link>
      ))}
      {extra > 0 && (
        <span style={{ marginLeft: 6, fontSize: '0.85em' }}>他 {extra} 人</span>
      )}
    </span>
  );
}

function buildHeaderText(g: NotifGroup): string | null {
  const first = g.authors[0];
  if (!first) return null;
  const firstName = first.displayName || first.handle;
  if (g.authors.length === 1) return firstName;
  const second = g.authors[1];
  if (!second) return firstName;
  const secondName = second.displayName || second.handle;
  if (g.authors.length === 2) return `${firstName}、${secondName}`;
  return `${firstName}、${secondName} 他 ${g.authors.length - 2} 人`;
}

function FollowPreview({ author }: { author: NotifGroup['authors'][number] }) {
  return (
    <div style={{ marginTop: '0.5em', fontSize: '0.9em' }}>
      <Link to={`/profile/${author.handle}`} onClick={(e) => e.stopPropagation()}>
        <strong>{author.displayName || author.handle}</strong>
      </Link>
      <span style={{ color: 'var(--color-muted)', marginLeft: '0.5em' }}>
        @{author.handle}
      </span>
    </div>
  );
}
