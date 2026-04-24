import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AppBskyFeedDefs, Agent } from '@atproto/api';
import { AppBskyFeedDefs as FeedDefs } from '@atproto/api';
import { useSession } from '@/lib/session';
import { fetchPostThread } from '@/lib/atproto';
import { postUri } from '@/lib/uri';
import { ThreadViewContainer } from '@/components/thread-view';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; thread: AppBskyFeedDefs.ThreadViewPost; uri: string }
  | { status: 'not-found' }
  | { status: 'blocked' }
  | { status: 'error'; message: string };

/**
 * /profile/:handle/post/:rkey の実装。
 * handle → DID 解決 → AT URI 組み立て → getPostThread → ThreadView。
 */
export function PostDetail() {
  const { handle, rkey } = useParams<{ handle: string; rkey: string }>();
  const session = useSession();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent) return;
    if (!handle || !rkey) {
      setState({ status: 'error', message: 'URL が不正です。' });
      return;
    }
    const agent = session.agent;
    let cancelled = false;
    (async () => {
      try {
        const did = await resolveHandleToDid(agent, handle);
        if (cancelled) return;
        if (!did) {
          setState({ status: 'error', message: `ユーザー "@${handle}" が見つかりません。` });
          return;
        }
        const uri = postUri(did, rkey);
        const thread = await fetchPostThread(agent, uri, { depth: 6, parentHeight: 10 });
        if (cancelled) return;
        if (FeedDefs.isThreadViewPost(thread)) {
          setState({ status: 'ready', thread, uri });
        } else if (FeedDefs.isNotFoundPost(thread)) {
          setState({ status: 'not-found' });
        } else if (FeedDefs.isBlockedPost(thread)) {
          setState({ status: 'blocked' });
        } else {
          setState({ status: 'error', message: '投稿を取得できませんでした。' });
        }
      } catch (e) {
        if (cancelled) return;
        setState({ status: 'error', message: String((e as Error)?.message ?? e) });
      }
    })();
    return () => { cancelled = true; };
  }, [handle, rkey, session.status, session.agent]);

  return (
    <div>
      <div style={{ marginBottom: '0.6em' }}>
        <Link to="/">← ホームに戻る</Link>
      </div>
      {state.status === 'loading' && <p>読み込み中…</p>}
      {state.status === 'not-found' && (
        <p style={{ color: 'var(--color-muted)' }}>投稿が見つかりません (削除された可能性)。</p>
      )}
      {state.status === 'blocked' && (
        <p style={{ color: 'var(--color-muted)' }}>この投稿はブロックされています。</p>
      )}
      {state.status === 'error' && (
        <p style={{ color: 'var(--color-danger)' }}>{state.message}</p>
      )}
      {state.status === 'ready' && (
        <ThreadViewContainer initialThread={state.thread} uri={state.uri} />
      )}
    </div>
  );
}

async function resolveHandleToDid(agent: Agent, handle: string): Promise<string | null> {
  // handle がすでに did: で始まっていればそのまま返す
  if (handle.startsWith('did:')) return handle;
  try {
    const res = await agent.getProfile({ actor: handle });
    return res.data.did ?? null;
  } catch {
    return null;
  }
}
