import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
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
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  // 投稿詳細は Workspace とは別ルートなので、戻り先は「直前に居た場所」(TL の途中・
  // プロフィール・通知など) であるべきで、常にホーム先頭ではない。
  // location.key は、この document 読み込み後に 1 回でも app 内 navigation が
  // push されていれば非 'default' になる (RR 7 は index 0 のエントリだけ 'default')。
  // その場合は history を pop する (navigate(-1))。pop で戻ると home カラムは IDB
  // キャッシュから即描画されるため以前の位置付近が保たれやすい (仮想リストなので
  // 厳密なピクセル単位の復元までは保証しない。少なくとも毎回先頭リセットは避けられる)。
  // 履歴が無い場合 (共有 URL の直開き等) はホームへのリンクにフォールバックする。
  const canGoBack = location.key !== 'default';

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
        {canGoBack ? (
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: 'var(--color-accent)',
              cursor: 'pointer',
              font: 'inherit',
              textDecoration: 'underline',
            }}
          >
            ← 戻る
          </button>
        ) : (
          <Link to="/">← ホームへ</Link>
        )}
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
