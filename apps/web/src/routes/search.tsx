import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { Archetype } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { useInfiniteFeed } from '@/lib/use-infinite-feed';
import { VirtualFeed } from '@/components/virtual-feed';
import { TextField } from '@/components/text-field';
import { Avatar } from '@/components/avatar';
import { PostArticle } from '@/components/post-article';
import { PostText } from '@/components/post-text';
import { useArchetypes } from '@/lib/archetype-cache';

type Mode = 'users' | 'posts';

export function Search() {
  const session = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  // URL の ?q= を初期値にセット。ハッシュタグ (#...) や引用記法から飛んできた時に
  // そのまま投稿モードで検索が走るよう、# 始まりは mode=posts に振る。
  const initialQ = searchParams.get('q') ?? '';
  const initialMode: Mode = searchParams.get('mode') === 'posts' || initialQ.startsWith('#') ? 'posts' : 'users';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [q, setQ] = useState(initialQ);
  const [submittedQ, setSubmittedQ] = useState(initialQ);

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
    // ブックマーク・共有ができるよう URL に反映 (#始まりは posts モードも一緒に書く)
    const next = new URLSearchParams(searchParams);
    next.set('q', t);
    if (mode === 'posts' || t.startsWith('#')) next.set('mode', 'posts'); else next.delete('mode');
    setSearchParams(next, { replace: true });
  }

  /** タブ切替時に mode を変えつつ、すでに検索済みなら URL の mode= も書き戻す。 */
  function switchMode(next: Mode) {
    setMode(next);
    if (!submittedQ) return; // 未検索ならまだ URL には書かない
    const params = new URLSearchParams(searchParams);
    if (next === 'posts') params.set('mode', 'posts'); else params.delete('mode');
    setSearchParams(params, { replace: true });
  }

  // URL の q が外部 (戻る/進む、別ページからのリンク) で変わったら state に追従
  useEffect(() => {
    const qFromUrl = searchParams.get('q') ?? '';
    if (qFromUrl !== submittedQ) {
      setQ(qFromUrl);
      setSubmittedQ(qFromUrl);
      const modeFromUrl = searchParams.get('mode') === 'posts' || qFromUrl.startsWith('#') ? 'posts' : 'users';
      setMode(modeFromUrl);
    }
    // submittedQ を deps に入れると loop するので意図的に除外
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // 以下は早期 return より前に置く (Hooks ルール: 順序を維持)
  const userDids = useMemo(() => users.items.map((u) => u.did), [users.items]);
  const postAuthorDids = useMemo(() => posts.items.map((p) => p.author.did), [posts.items]);
  const usersArchetypes = useArchetypes(agent ?? null, userDids);
  const postsArchetypes = useArchetypes(agent ?? null, postAuthorDids);

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
        <button className={`dq-tab${mode === 'users' ? ' active' : ''}`} onClick={() => switchMode('users')}>ユーザー</button>
        <button className={`dq-tab${mode === 'posts' ? ' active' : ''}`} onClick={() => switchMode('posts')}>投稿</button>
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
            renderItem={(u) => <UserCard user={u} archetype={usersArchetypes.get(u.did) ?? null} />}
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
            renderItem={(p) => <PostHit post={p} archetype={postsArchetypes.get(p.author.did) ?? null} />}
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

function UserCard({ user, archetype }: { user: AppBskyActorDefs.ProfileView; archetype?: Archetype | null }) {
  return (
    <article className="dq-window">
      <div style={{ display: 'flex', gap: '0.6em', alignItems: 'center' }}>
        <Avatar src={user.avatar} size={36} archetype={archetype ?? null} />
        <div style={{ flex: 1 }}>
          <div>
            <Link to={`/profile/${user.handle}`}><strong>{user.displayName || user.handle}</strong></Link>
          </div>
          <div style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>@{user.handle}</div>
        </div>
      </div>
      {user.description && (
        <PostText text={user.description} style={{ marginTop: '0.4em', fontSize: '0.85em' }} />
      )}
    </article>
  );
}

function PostHit({ post, archetype }: { post: AppBskyFeedDefs.PostView; archetype?: Archetype | null }) {
  return <PostArticle post={post} archetype={archetype ?? null} avatarSize={28} expandable />;
}
