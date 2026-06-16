import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { Archetype } from '@aozoraquest/core';
import { Avatar } from './avatar';
import { PostBody } from './post-body';
import { PostMetrics } from './post-metrics';
import { InlineThread } from './inline-thread';
import { RepeatIcon } from './icons';
import { CognitiveTriggerIcon, CognitiveScores } from './post-cognitive-badge';
import { useCognitiveAnalysis } from '@/lib/post-cognitive';
import { displayWidth } from '@/lib/text-width';
import { extractPostExternal, extractPostImages, extractPostVideo } from '@/lib/post-embed';

/** 名前がこの表示幅を超えたら、タイムラインでは @handle を畳む (折り返し防止)。 */
const HANDLE_HIDE_WIDTH = 18;

export interface PostRecordShape {
  text?: string;
  createdAt?: string;
  langs?: string[];
  reply?: { root?: { uri?: string }; parent?: { uri?: string } };
  facets?: Parameters<typeof PostBody>[0]['facets'];
}

export interface PostArticleProps {
  post: AppBskyFeedDefs.PostView;
  archetype?: Archetype | null;
  /** Avatar のサイズ (px)。既定 40 */
  avatarSize?: number;
  /** ヘッダの右端に差し込むスロット (相性ラベルなど) */
  headerExtra?: ReactNode;
  /** 詳細ページ等で当該投稿をハイライト */
  highlight?: boolean;
  /** true なら PostMetrics に ▼ スレッド展開トグルが出る。展開中は下部に InlineThread */
  expandable?: boolean;
  /** リポスト由来で流れてきた場合、リポストした人を表示 (🔁 <name> がリポスト) */
  repostedBy?: AppBskyActorDefs.ProfileViewBasic | undefined;
  /** タイムライン表示では @handle を一切出さない (表示名で識別、handle は profile で確認)。 */
  hideHandle?: boolean;
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
  avatarSize = 40,
  headerExtra,
  highlight = false,
  expandable = false,
  repostedBy,
  hideHandle = false,
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
  // タイムラインでは @handle を出さない (hideHandle)。それ以外でも、名前が長い
  // (= 折り返す) ときは畳む。名前が無いときは strong が handle を出すので不要。
  const showHandle = !hideHandle && !!author.displayName && displayWidth(author.displayName) <= HANDLE_HIDE_WIDTH;
  // 返信が 1 件以上、または自身がリプライ (親がある) 投稿はスレッドを持つ。
  const hasReplies = (post.replyCount ?? 0) > 0;
  const isReply = !!record.reply;
  const hasThread = hasReplies || isReply;
  const showToggle = expandable && hasThread;
  // 気質分析: トリガー脳アイコンはヘッダ右端、結果チップは本文下に出す。
  // hook はここで 1 回だけ呼ぶ (二重分析を避ける)。
  const cog = useCognitiveAnalysis(post.uri, record.text ?? '');

  return (
    <article
      ref={articleRef}
      // feed-post: モバイル workspace カラムで「全幅タイムライン行」化する対象を
      // 投稿カードに限定するためのマーカー (board のクエストカード等は状態色の枠を
      // 残したいので対象外にする。styles.css のモバイルブロック参照)。
      className="dq-window feed-post"
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
        {showHandle && <span>@{author.handle}</span>}
        {headerExtra}
        {cog.canAnalyze && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', flexShrink: 0 }}>
            <CognitiveTriggerIcon state={cog.state} error={cog.error} onAnalyze={cog.triggerAnalyze} />
          </span>
        )}
      </div>
      <PostBody
        text={record.text ?? ''}
        facets={record.facets}
        images={extractPostImages(post)}
        external={extractPostExternal(post)}
        video={extractPostVideo(post)}
        postUri={post.uri}
        {...(record.langs ? { langs: record.langs } : {})}
      />
      {cog.canAnalyze && cog.state === 'done' && cog.scores && <CognitiveScores scores={cog.scores} />}
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
