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
import { useCompose, useOnPosted } from '@/components/compose-modal';
import { PostText } from '@/components/post-text';
import { seedArchetype, useArchetypes } from '@/lib/archetype-cache';

type Tab = 'following' | 'resonance';

export function Home() {
  const session = useSession();
  const config = useRuntimeConfig();
  const [tab, setTab] = useState<Tab>('following');
  const [selfDiag, setSelfDiag] = useState<DiagnosisResult | null>(null);
  const [targetJob, setTargetJob] = useState<Archetype | null>(null);
  const { openCompose } = useCompose();

  const agent = session.agent;

  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !session.did) return;
    const did = session.did;
    getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self')
      .then((r) => {
        setSelfDiag(r);
        // 自分の archetype をキャッシュに入れておく
        const a = r?.archetype && r.archetype in JOBS_BY_ID ? (r.archetype as Archetype) : null;
        seedArchetype(did, a);
      })
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

  // 自分が投稿した直後にフォロー TL をリフレッシュする (自分の投稿が即表示される)
  // Bluesky の timeline は書き込みから反映まで数秒ラグがあるので少し待ってから。
  useOnPosted(() => {
    setTimeout(() => followingFeed.refresh(), 500);
    // 投稿解析で rpgStats が変わるのでレーダーも更新
    if (agent && session.did) {
      const a = agent;
      const d = session.did;
      setTimeout(() => {
        getRecord<DiagnosisResult>(a, d, 'app.aozoraquest.analysis', 'self')
          .then((r) => { if (r) setSelfDiag(r); })
          .catch(() => {});
      }, 400);
    }
  });

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

  // フォロー TL の著者 archetype 解決
  const followingAuthorDids = useMemo(
    () => followingFeed.items.map((it) => it.post.author.did),
    [followingFeed.items],
  );
  const followingArchetypes = useArchetypes(agent ?? null, followingAuthorDids);

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
      {session.did && <HomeSummary agent={agent ?? null} diag={selfDiag} userDid={session.did} targetStats={targetStats} />}

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
        <button onClick={() => openCompose()}>投稿する</button>
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
            renderItem={(item) => (
              <PostCard item={item} archetype={followingArchetypes.get(item.post.author.did) ?? null} />
            )}
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

interface PostRecord {
  text?: string;
  createdAt?: string;
  facets?: Array<{ index: { byteStart: number; byteEnd: number }; features?: Array<{ $type?: string; uri?: string; did?: string; tag?: string }> }>;
}

function PostCard({ item, archetype }: { item: AppBskyFeedDefs.FeedViewPost; archetype?: Archetype | null }) {
  const post = item.post;
  const author = post.author;
  const record = post.record as PostRecord;
  return (
    <article className="dq-window">
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        <Avatar src={author.avatar} size={32} archetype={archetype ?? null} />
        <Link to={`/profile/${author.handle}`}>
          <strong>{author.displayName || author.handle}</strong>
        </Link>
        <span>@{author.handle}</span>
      </div>
      <PostText text={record.text ?? ''} facets={record.facets} style={{ marginTop: '0.45em' }} />
      <PostMetrics post={post} />
    </article>
  );
}

function ResonancePostCard({ entry }: { entry: ResonanceEntry }) {
  const post = entry.item.post;
  const author = post.author;
  const record = post.record as PostRecord;
  return (
    <article className="dq-window">
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        <Avatar src={author.avatar} size={32} archetype={entry.theirArchetype} />
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
      <PostText text={record.text ?? ''} facets={record.facets} style={{ marginTop: '0.45em' }} />
      <PostMetrics post={post} />
    </article>
  );
}
