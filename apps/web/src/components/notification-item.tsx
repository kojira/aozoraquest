import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AppBskyFeedDefs } from '@atproto/api';
import { Avatar } from './avatar';
import { PostArticle } from './post-article';
import {
  AtIcon,
  BellIcon,
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
    case 'subscribed-post':
      return BellIcon;
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
  const [expanded, setExpanded] = useState(false);
  const Icon = iconFor(group.reason);
  const label = labelForReason(group.reason);
  const previewUri = previewUriForGroup(group);
  const post = previewUri ? postCache.get(previewUri) : undefined;
  // 同一 author が連投したケース (subscribed-post で 1 人が 20 件連投など) は
  // 1 人 1 行に集約。group.authors は notification 1 件ごとに重複し得るので
  // did で dedupe してから UI に渡す。出現順は最古発見順 = notification DESC。
  const uniqueAuthors = dedupeAuthorsByDid(group.authors);
  const primary = uniqueAuthors[0];
  if (!primary) return null;
  // 2 人以上集約されている時だけ accordion を出す (1 人なら展開しても情報増えない)。
  const expandable = uniqueAuthors.length > 1;

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

  const headerText = buildHeaderText(uniqueAuthors);

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
        <AuthorStack authors={uniqueAuthors} />
        <span>
          が<strong style={{ color: 'var(--color-fg)' }}>{label}</strong>しました
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace' }}>
          {formatDateTime(group.latestAt)}
        </span>
        {expandable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-expanded={expanded}
            aria-label={expanded ? '反応した人の一覧を閉じる' : '反応した人の一覧を開く'}
            title={expanded ? '閉じる' : `反応した ${uniqueAuthors.length} 人を表示`}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '0 0.3em',
              cursor: 'pointer',
              color: 'var(--color-muted)',
              fontSize: '0.85em',
              lineHeight: 1,
            }}
          >
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>
      {headerText && !expanded && (
        <p style={{ marginTop: '0.4em', fontSize: '0.85em', color: 'var(--color-muted)' }}>
          {headerText}
        </p>
      )}
      {expanded && (
        <ExpandedAuthorList authors={uniqueAuthors} />
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

/** accordion 展開時の全 author 縦リスト。 */
function ExpandedAuthorList({ authors }: { authors: NotifGroup['authors'] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '0.5em 0 0 0', display: 'flex', flexDirection: 'column', gap: '0.4em' }}>
      {authors.map((a) => (
        <li key={a.did}>
          <Link
            to={`/profile/${a.handle}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5em',
              fontSize: '0.85em',
              color: 'inherit',
              textDecoration: 'none',
            }}
          >
            <Avatar src={a.avatar} size={24} archetype={null} />
            <span style={{ fontWeight: 600 }}>{a.displayName || a.handle}</span>
            <span style={{ color: 'var(--color-muted)' }}>@{a.handle}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function dedupeAuthorsByDid(authors: NotifGroup['authors']): NotifGroup['authors'] {
  const seen = new Set<string>();
  const out: NotifGroup['authors'] = [];
  for (const a of authors) {
    if (seen.has(a.did)) continue;
    seen.add(a.did);
    out.push(a);
  }
  return out;
}

function buildHeaderText(authors: NotifGroup['authors']): string | null {
  const first = authors[0];
  if (!first) return null;
  const firstName = first.displayName || first.handle;
  if (authors.length === 1) return firstName;
  const second = authors[1];
  if (!second) return firstName;
  const secondName = second.displayName || second.handle;
  if (authors.length === 2) return `${firstName}、${secondName}`;
  return `${firstName}、${secondName} 他 ${authors.length - 2} 人`;
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
