import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppBskyFeedDefs } from '@atproto/api';
import type { Archetype, DiagnosisResult, StatVector } from '@aozoraquest/core';
import { JOBS_BY_ID, resonanceLabel, statArrayToVector } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { fetchTimeline, getRecord } from '@/lib/atproto';
import { buildResonanceTimeline, type ResonanceEntry } from '@/lib/resonance-flow';
import { useRuntimeConfig } from '@/components/config-provider';
import { useInfiniteFeed } from '@/lib/use-infinite-feed';
import { VirtualFeed } from '@/components/virtual-feed';
import { Avatar } from '@/components/avatar';
import { HomeSummary } from '@/components/home-summary';
import { PostMetrics } from '@/components/post-metrics';

type Tab = 'following' | 'resonance';

export function Home() {
  const session = useSession();
  const config = useRuntimeConfig();
  const [tab, setTab] = useState<Tab>('following');
  const [selfDiag, setSelfDiag] = useState<DiagnosisResult | null>(null);
  const [targetJob, setTargetJob] = useState<Archetype | null>(null);

  const agent = session.agent;

  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !session.did) return;
    const did = session.did;
    getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self')
      .then((r) => setSelfDiag(r))
      .catch((e) => console.warn('self analysis load failed', e));
    getRecord<{ targetJob?: string }>(agent, did, 'app.aozoraquest.profile', 'self')
      .then((p) => {
        if (p?.targetJob && p.targetJob in JOBS_BY_ID) setTargetJob(p.targetJob as Archetype);
      })
      .catch((e) => console.warn('profile load failed', e));
  }, [session.status, agent, session.did]);

  const targetStats: StatVector | null = useMemo(
    () => (targetJob ? statArrayToVector(JOBS_BY_ID[targetJob].stats) : null),
    [targetJob],
  );

  // フォロー TL: カーソル無限スクロール
  const followingFeed = useInfiniteFeed<AppBskyFeedDefs.FeedViewPost>({
    enabled: session.status === 'signed-in' && tab === 'following' && !!agent,
    keyOf: (x) => x.post.uri,
    deps: [session.status, agent, tab],
    fetchPage: async (cursor) => {
      if (!agent) return { items: [] };
      const res = await fetchTimeline(agent, cursor);
      return {
        items: res.data.feed,
        ...(res.data.cursor !== undefined ? { cursor: res.data.cursor } : {}),
      };
    },
  });

  // 共鳴 TL: ディレクトリベース一括取得 (件数は directory ≤ 30 に自然制約)
  const [resonanceFeed, setResonanceFeed] = useState<ResonanceEntry[]>([]);
  const [resonanceLoading, setResonanceLoading] = useState(false);
  const [resonanceErr, setResonanceErr] = useState<string | null>(null);

  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || tab !== 'resonance') return;
    setResonanceLoading(true);
    setResonanceErr(null);
    const dids = config.directory.map((u) => u.did).filter((d) => d !== session.did);
    buildResonanceTimeline(agent, { selfDiagnosis: selfDiag, directoryDids: dids })
      .then((list) => setResonanceFeed(list))
      .catch((e) => setResonanceErr(String((e as Error)?.message ?? e)))
      .finally(() => setResonanceLoading(false));
  }, [session.status, agent, session.did, tab, selfDiag, config.directory]);

  if (session.status === 'loading') return <p>準備しています...</p>;

  if (session.status === 'signed-out') {
    return (
      <div>
        <h2>あおぞらくえすと</h2>
        <p style={{ color: 'var(--color-muted)' }}>
          Bluesky で読み書きしながら、あなたの気質をゆっくり見つけていくアプリ。
        </p>
        <Link to="/onboarding"><button style={{ marginTop: '1em' }}>ログインして始める</button></Link>
      </div>
    );
  }

  return (
    <div>
      {session.did && <HomeSummary diag={selfDiag} userDid={session.did} targetStats={targetStats} />}

      <div className="dq-tabs">
        {(['following', 'resonance'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`dq-tab${tab === t ? ' active' : ''}`}
          >
            {t === 'following' ? 'フォロー' : '共鳴'}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '0.5em', textAlign: 'right' }}>
        <Link to="/compose">
          <button>投稿する</button>
        </Link>
      </div>

      {tab === 'following' && (
        <section style={{ marginTop: '1em' }}>
          {followingFeed.err && <p style={{ color: 'var(--color-danger)' }}>うまく読み込めませんでした: {followingFeed.err}</p>}
          {!followingFeed.loading && followingFeed.items.length === 0 && !followingFeed.err && (
            <p style={{ color: 'var(--color-muted)' }}>タイムラインが空です。</p>
          )}
          <VirtualFeed
            items={followingFeed.items}
            keyOf={(x) => x.post.uri}
            renderItem={(item) => <PostCard item={item} />}
            onEndReached={followingFeed.done ? undefined : followingFeed.loadMore}
            footer={
              <>
                {followingFeed.loading && <p style={{ textAlign: 'center' }}>読み込み中...</p>}
                {followingFeed.done && followingFeed.items.length > 0 && (
                  <p style={{ textAlign: 'center', fontSize: '0.8em', color: 'var(--color-muted)' }}>
                    これ以上はありません。
                  </p>
                )}
              </>
            }
          />
        </section>
      )}

      {tab === 'resonance' && (
        <section style={{ marginTop: '1em' }}>
          {!selfDiag && (
            <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
              あなたの気質がまだ分からないので、新しい順に並べています。
              <Link to="/me">自分のページ</Link> で気質を調べると、あなたに近い人の投稿が先に来るようになります。
            </p>
          )}
          {config.directory.length === 0 && (
            <p style={{ color: 'var(--color-muted)' }}>
              まだ誰も「共鳴」タブに参加していません。
              <Link to="/settings">設定</Link> から参加すると、似た気質の人たちの投稿が少しずつ集まってきます。
            </p>
          )}
          {resonanceLoading && <p>読み込み中...</p>}
          {resonanceErr && <p style={{ color: 'var(--color-danger)' }}>うまく読み込めませんでした: {resonanceErr}</p>}
          {!resonanceLoading && resonanceFeed.length === 0 && !resonanceErr && config.directory.length > 0 && (
            <p style={{ color: 'var(--color-muted)' }}>
              まだあなたと響きあう投稿が見つかりません。参加者が増えると少しずつ流れてきます。
            </p>
          )}
          <VirtualFeed
            items={resonanceFeed}
            keyOf={(x) => x.item.post.uri}
            renderItem={(entry) => <ResonancePostCard entry={entry} />}
          />
        </section>
      )}
    </div>
  );
}

function PostCard({ item }: { item: AppBskyFeedDefs.FeedViewPost }) {
  const post = item.post;
  const author = post.author;
  const record = post.record as { text?: string; createdAt?: string };
  return (
    <article className="dq-window">
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        <Avatar src={author.avatar} size={32} />
        <Link to={`/profile/${author.handle}`}>
          <strong>{author.displayName || author.handle}</strong>
        </Link>
        <span>@{author.handle}</span>
      </div>
      <div style={{ marginTop: '0.45em', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{record.text ?? ''}</div>
      <PostMetrics likeCount={post.likeCount} repostCount={post.repostCount} replyCount={post.replyCount} />
    </article>
  );
}

function ResonancePostCard({ entry }: { entry: ResonanceEntry }) {
  const post = entry.item.post;
  const author = post.author;
  const record = post.record as { text?: string; createdAt?: string };
  return (
    <article className="dq-window">
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        <Avatar src={author.avatar} size={32} />
        <Link to={`/profile/${author.handle}`}>
          <strong>{author.displayName || author.handle}</strong>
        </Link>
        <span>@{author.handle}</span>
        {entry.score != null && (
          <span
            title={`近さ ${((entry.similarity ?? 0) * 100).toFixed(0)} / 補い ${((entry.complementarity ?? 0) * 100).toFixed(0)}`}
            style={{ marginLeft: 'auto', fontSize: '0.75em', color: 'var(--color-accent)' }}
          >
            {resonanceLabel(entry.score)}
          </span>
        )}
      </div>
      <div style={{ marginTop: '0.45em', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{record.text ?? ''}</div>
      <PostMetrics likeCount={post.likeCount} repostCount={post.repostCount} replyCount={post.replyCount} />
    </article>
  );
}
