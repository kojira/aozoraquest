import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppBskyFeedDefs } from '@atproto/api';
import type { DiagnosisResult } from '@aozoraquest/core';
import { resonanceLabel } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { fetchTimeline, getRecord } from '@/lib/atproto';
import { buildResonanceTimeline, type ResonanceEntry } from '@/lib/resonance-flow';
import { useRuntimeConfig } from '@/components/config-provider';

type Tab = 'following' | 'resonance';

export function Home() {
  const session = useSession();
  const config = useRuntimeConfig();
  const [tab, setTab] = useState<Tab>('following');
  const [feed, setFeed] = useState<AppBskyFeedDefs.FeedViewPost[]>([]);
  const [resonanceFeed, setResonanceFeed] = useState<ResonanceEntry[]>([]);
  const [selfDiag, setSelfDiag] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self')
      .then((r) => setSelfDiag(r))
      .catch((e) => console.warn('self analysis load failed', e));
  }, [session.status, session.agent, session.did]);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent) return;
    if (tab === 'following') {
      setLoading(true);
      setErr(null);
      fetchTimeline(session.agent)
        .then((res) => setFeed(res.data.feed))
        .catch((e) => setErr(String((e as Error)?.message ?? e)))
        .finally(() => setLoading(false));
    } else {
      setLoading(true);
      setErr(null);
      const dids = config.directory.map((u) => u.did).filter((d) => d !== session.did);
      buildResonanceTimeline(session.agent, { selfDiagnosis: selfDiag, directoryDids: dids })
        .then((list) => setResonanceFeed(list))
        .catch((e) => setErr(String((e as Error)?.message ?? e)))
        .finally(() => setLoading(false));
    }
  }, [session.status, session.agent, session.did, tab, selfDiag, config.directory]);

  if (session.status === 'loading') return <p>準備しています...</p>;

  if (session.status === 'signed-out') {
    return (
      <div>
        <h2>Aozora Quest</h2>
        <p style={{ color: 'var(--color-muted)' }}>
          Bluesky で読み書きしながら、あなたの気質をゆっくり見つけていくアプリ。
        </p>
        <Link to="/onboarding"><button style={{ marginTop: '1em' }}>ログインして始める</button></Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.4em', marginTop: '0.5em' }}>
        {(['following', 'resonance'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '0.5em',
              background: tab === t ? 'var(--color-primary)' : 'transparent',
              color: tab === t ? 'white' : 'var(--color-fg)',
              border: '1px solid var(--color-border)',
              borderRadius: '4px',
            }}
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
          {loading && <p>読み込み中...</p>}
          {err && <p style={{ color: '#b00' }}>エラー: {err}</p>}
          {!loading && feed.length === 0 && !err && (
            <p style={{ color: 'var(--color-muted)' }}>タイムラインが空です。</p>
          )}
          {feed.map((item) => (
            <PostCard key={item.post.uri} item={item} />
          ))}
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
          {loading && <p>読み込み中...</p>}
          {err && <p style={{ color: '#b00' }}>うまく読み込めませんでした: {err}</p>}
          {!loading && resonanceFeed.length === 0 && !err && config.directory.length > 0 && (
            <p style={{ color: 'var(--color-muted)' }}>
              まだあなたと響きあう投稿が見つかりません。参加者が増えると少しずつ流れてきます。
            </p>
          )}
          {resonanceFeed.map((entry) => (
            <ResonancePostCard key={entry.item.post.uri} entry={entry} />
          ))}
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
    <article style={{ padding: '0.8em 0', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        {author.avatar && <img src={author.avatar} alt="" width={32} height={32} style={{ borderRadius: '50%' }} />}
        <Link to={`/profile/${author.handle}`}>
          <strong>{author.displayName || author.handle}</strong>
        </Link>
        <span>@{author.handle}</span>
      </div>
      <div style={{ marginTop: '0.3em', whiteSpace: 'pre-wrap' }}>{record.text ?? ''}</div>
      <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.3em' }}>
        ♡ {post.likeCount ?? 0} · 🔁 {post.repostCount ?? 0} · 💬 {post.replyCount ?? 0}
      </div>
    </article>
  );
}

function ResonancePostCard({ entry }: { entry: ResonanceEntry }) {
  const post = entry.item.post;
  const author = post.author;
  const record = post.record as { text?: string; createdAt?: string };
  return (
    <article style={{ padding: '0.8em 0', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        {author.avatar && <img src={author.avatar} alt="" width={32} height={32} style={{ borderRadius: '50%' }} />}
        <Link to={`/profile/${author.handle}`}>
          <strong>{author.displayName || author.handle}</strong>
        </Link>
        <span>@{author.handle}</span>
        {entry.score != null && (
          <span
            title={`近さ ${((entry.similarity ?? 0) * 100).toFixed(0)} / 補い ${((entry.complementarity ?? 0) * 100).toFixed(0)}`}
            style={{ marginLeft: 'auto', fontSize: '0.75em', color: 'var(--color-primary)' }}
          >
            {resonanceLabel(entry.score)}
          </span>
        )}
      </div>
      <div style={{ marginTop: '0.3em', whiteSpace: 'pre-wrap' }}>{record.text ?? ''}</div>
      <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.3em' }}>
        ♡ {post.likeCount ?? 0} · 🔁 {post.repostCount ?? 0} · 💬 {post.replyCount ?? 0}
      </div>
    </article>
  );
}
