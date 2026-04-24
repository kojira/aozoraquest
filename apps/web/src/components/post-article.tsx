import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { Archetype } from '@aozoraquest/core';
import { Avatar } from './avatar';
import { PostBody } from './post-body';
import { PostMetrics } from './post-metrics';
import { InlineThread } from './inline-thread';
import { RepeatIcon } from './icons';
import { formatDateTime } from '@/lib/format-datetime';
import { extractPostExternal, extractPostImages } from '@/lib/post-embed';
import { postDetailPath } from '@/lib/uri';

interface PostRecordShape {
  text?: string;
  createdAt?: string;
  reply?: { root?: { uri?: string }; parent?: { uri?: string } };
  facets?: Parameters<typeof PostBody>[0]['facets'];
}

export interface PostArticleProps {
  post: AppBskyFeedDefs.PostView;
  archetype?: Archetype | null;
  /** Avatar のサイズ (px)。既定 32 */
  avatarSize?: number;
  /** ヘッダの右端に差し込むスロット (相性ラベルなど) */
  headerExtra?: ReactNode;
  /** 詳細ページ等で当該投稿をハイライト */
  highlight?: boolean;
  /** true なら PostMetrics に ▼ スレッド展開トグルが出る。展開中は下部に InlineThread */
  expandable?: boolean;
  /** リポスト由来で流れてきた場合、リポストした人を表示 (🔁 <name> がリポスト) */
  repostedBy?: AppBskyActorDefs.ProfileViewBasic | undefined;
}

/**
 * タイムライン / 検索 / 詳細 / スレッド でも使い回せる投稿カード。
 * 構造: article + ヘッダ (avatar + author + handle + extra + timestamp-link) +
 * PostBody (text + images + external) + PostMetrics。
 * expandable=true のときはインラインスレッド展開の挙動を持つ。
 */
export function PostArticle({
  post,
  archetype,
  avatarSize = 32,
  headerExtra,
  highlight = false,
  expandable = false,
  repostedBy,
}: PostArticleProps) {
  const [expanded, setExpanded] = useState(false);
  const articleRef = useRef<HTMLElement>(null);

  const onToggle = useCallback(() => {
    setExpanded((v) => {
      const next = !v;
      // 展開時は当該カードを画面上部にスクロールして、下方向伸びによる
      // 視線のズレを最小化する。
      if (next && articleRef.current) {
        queueMicrotask(() => {
          articleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      return next;
    });
  }, []);

  const author = post.author;
  const record = post.record as PostRecordShape;
  const ts = record.createdAt ?? post.indexedAt;
  const detailPath = postDetailPath(author.handle, post.uri);
  // 返信が 1 件以上、または自身がリプライ (親がある) 投稿はスレッドを持つ。
  const hasReplies = (post.replyCount ?? 0) > 0;
  const isReply = !!record.reply;
  const hasThread = hasReplies || isReply;
  const showToggle = expandable && hasThread;

  return (
    <article
      ref={articleRef}
      className="dq-window"
      style={highlight ? { outline: '2px solid var(--color-accent)', outlineOffset: -2 } : undefined}
    >
      {repostedBy && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4em',
            fontSize: '0.78em',
            color: 'var(--color-muted)',
            marginBottom: '0.4em',
          }}
        >
          <RepeatIcon size={13} />
          <Link
            to={`/profile/${repostedBy.handle}`}
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3em', color: 'inherit' }}
          >
            <Avatar src={repostedBy.avatar} size={18} archetype={null} />
            <span>{repostedBy.displayName || repostedBy.handle}</span>
          </Link>
          <span>がリポスト</span>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: '0.5em',
          alignItems: 'center',
          fontSize: '0.85em',
          color: 'var(--color-muted)',
          flexWrap: 'wrap',
        }}
      >
        <Avatar src={author.avatar} size={avatarSize} archetype={archetype ?? null} />
        <Link to={`/profile/${author.handle}`} onClick={(e) => e.stopPropagation()}>
          <strong>{author.displayName || author.handle}</strong>
        </Link>
        <span>@{author.handle}</span>
        {headerExtra}
        <Link
          to={detailPath}
          onClick={(e) => e.stopPropagation()}
          style={{
            marginLeft: headerExtra ? 0 : 'auto',
            fontFamily: 'ui-monospace, monospace',
            color: 'inherit',
            textDecoration: 'none',
          }}
          title="投稿詳細を開く"
        >
          <time dateTime={ts}>{formatDateTime(ts)}</time>
        </Link>
      </div>
      <PostBody
        text={record.text ?? ''}
        facets={record.facets}
        images={extractPostImages(post)}
        external={extractPostExternal(post)}
      />
      <PostMetrics
        post={post}
        {...(showToggle ? { onToggleThread: onToggle, threadExpanded: expanded } : {})}
      />
      {showToggle && expanded && (
        <InlineThread postUri={post.uri} authorHandle={author.handle} />
      )}
    </article>
  );
}
