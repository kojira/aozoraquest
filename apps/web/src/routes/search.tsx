import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import { useSession } from '@/lib/session';
import { useInfiniteFeed } from '@/lib/use-infinite-feed';
import { VirtualFeed } from '@/components/virtual-feed';
import { TextField } from '@/components/text-field';
import { Avatar } from '@/components/avatar';
import { PostMetrics } from '@/components/post-metrics';

type Mode = 'users' | 'posts';

export function Search() {
  const session = useSession();
  const [mode, setMode] = useState<Mode>('users');
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');

  const agent = session.agent;

  const users = useInfiniteFeed<AppBskyActorDefs.ProfileView>({
    enabled: session.status === 'signed-in' && !!agent && mode === 'users' && submittedQ.length > 0,
    keyOf: (u) => u.did,
    deps: [session.status, agent, mode, submittedQ],
    fetchPage: async (cursor) => {
      if (!agent) return { items: [] };
      const res = await agent.app.bsky.actor.searchActors({
        q: submittedQ,
        limit: 25,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      return {
        items: res.data.actors,
        ...(res.data.cursor !== undefined ? { cursor: res.data.cursor } : {}),
      };
    },
  });

  const posts = useInfiniteFeed<AppBskyFeedDefs.PostView>({
    enabled: session.status === 'signed-in' && !!agent && mode === 'posts' && submittedQ.length > 0,
    keyOf: (p) => p.uri,
    deps: [session.status, agent, mode, submittedQ],
    fetchPage: async (cursor) => {
      if (!agent) return { items: [] };
      const res = await agent.app.bsky.feed.searchPosts({
        q: submittedQ,
        limit: 25,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      return {
        items: res.data.posts,
        ...(res.data.cursor !== undefined ? { cursor: res.data.cursor } : {}),
      };
    },
  });

  function submit() {
    const t = q.trim();
    if (!t) return;
    setSubmittedQ(t);
  }

  if (session.status !== 'signed-in') {
    return (
      <div>
        <h2>検索</h2>
        <p>まずはログインしてください。</p>
        <Link to="/onboarding"><button>ログイン</button></Link>
      </div>
    );
  }

  const active = mode === 'users' ? users : posts;

  return (
    <div>
      <h2>検索</h2>

      <div className="dq-tabs">
        <button className={`dq-tab${mode === 'users' ? ' active' : ''}`} onClick={() => setMode('users')}>ユーザー</button>
        <button className={`dq-tab${mode === 'posts' ? ' active' : ''}`} onClick={() => setMode('posts')}>投稿</button>
      </div>

      <div style={{ display: 'flex', gap: '0.4em', marginTop: '0.7em' }}>
        <TextField
          value={q}
          onChange={setQ}
          onSubmit={submit}
          placeholder={mode === 'users' ? 'ハンドル・表示名など' : 'キーワード'}
          style={{ flex: 1 }}
        />
        <button onClick={submit} disabled={!q.trim()}>検索</button>
      </div>

      {active.err && <p style={{ color: 'var(--color-danger)', marginTop: '0.5em' }}>うまく検索できませんでした: {active.err}</p>}
      {!active.loading && !active.err && submittedQ && active.items.length === 0 && (
        <p style={{ color: 'var(--color-muted)', marginTop: '1em' }}>見つかりませんでした。</p>
      )}

      <section style={{ marginTop: '1em' }}>
        {mode === 'users' && (
          <VirtualFeed
            items={users.items}
            keyOf={(u) => u.did}
            estimateSize={120}
            renderItem={(u) => <UserCard user={u} />}
            onEndReached={users.done ? undefined : users.loadMore}
            footer={
              <>
                {users.loading && <p style={{ textAlign: 'center' }}>読み込み中...</p>}
                {users.done && users.items.length > 0 && (
                  <p style={{ textAlign: 'center', fontSize: '0.8em', color: 'var(--color-muted)' }}>
                    これ以上はありません。
                  </p>
                )}
              </>
            }
          />
        )}

        {mode === 'posts' && (
          <VirtualFeed
            items={posts.items}
            keyOf={(p) => p.uri}
            renderItem={(p) => <PostHit post={p} />}
            onEndReached={posts.done ? undefined : posts.loadMore}
            footer={
              <>
                {posts.loading && <p style={{ textAlign: 'center' }}>読み込み中...</p>}
                {posts.done && posts.items.length > 0 && (
                  <p style={{ textAlign: 'center', fontSize: '0.8em', color: 'var(--color-muted)' }}>
                    これ以上はありません。
                  </p>
                )}
              </>
            }
          />
        )}
      </section>
    </div>
  );
}

function UserCard({ user }: { user: AppBskyActorDefs.ProfileView }) {
  return (
    <article className="dq-window">
      <div style={{ display: 'flex', gap: '0.6em', alignItems: 'center' }}>
        <Avatar src={user.avatar} size={36} />
        <div style={{ flex: 1 }}>
          <div>
            <Link to={`/profile/${user.handle}`}><strong>{user.displayName || user.handle}</strong></Link>
          </div>
          <div style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>@{user.handle}</div>
        </div>
      </div>
      {user.description && (
        <div style={{ marginTop: '0.4em', fontSize: '0.85em', whiteSpace: 'pre-wrap' }}>{user.description}</div>
      )}
    </article>
  );
}

function PostHit({ post }: { post: AppBskyFeedDefs.PostView }) {
  const rec = post.record as { text?: string; createdAt?: string };
  return (
    <article className="dq-window">
      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        <Avatar src={post.author.avatar} size={28} />
        <Link to={`/profile/${post.author.handle}`}>
          <strong>{post.author.displayName || post.author.handle}</strong>
        </Link>
        <span>@{post.author.handle}</span>
      </div>
      <div style={{ marginTop: '0.45em', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{rec.text ?? ''}</div>
      <PostMetrics post={post} />
    </article>
  );
}
