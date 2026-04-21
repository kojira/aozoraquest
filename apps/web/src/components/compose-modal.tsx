import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { createPost, type ReplyRef } from '@/lib/atproto';
import { TextField } from './text-field';
import { processSelfPost } from '@/lib/post-processor';

export interface ComposeReplyTo {
  parent: { uri: string; cid: string };
  root: { uri: string; cid: string };
  author: string;
  text: string;
}

// 投稿成功イベント (タイムライン側が購読して自分の投稿をすぐ反映する)
type PostedListener = () => void;
const postedListeners = new Set<PostedListener>();
function notifyPosted() {
  for (const cb of postedListeners) {
    try { cb(); } catch (e) { console.warn('posted listener failed', e); }
  }
}

/** 自分が投稿を作成した直後に呼ばれるコールバックを登録する。return で解除。 */
export function useOnPosted(cb: PostedListener) {
  useEffect(() => {
    postedListeners.add(cb);
    return () => {
      postedListeners.delete(cb);
    };
  }, [cb]);
}

interface ComposeCtx {
  openCompose: (replyTo?: ComposeReplyTo) => void;
  closeCompose: () => void;
}

const ComposeContext = createContext<ComposeCtx>({ openCompose: () => {}, closeCompose: () => {} });

export function useCompose(): ComposeCtx {
  return useContext(ComposeContext);
}

interface ProviderState {
  open: boolean;
  replyTo: ComposeReplyTo | null;
}

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProviderState>({ open: false, replyTo: null });

  const openCompose = useCallback((replyTo?: ComposeReplyTo) => {
    setState({ open: true, replyTo: replyTo ?? null });
  }, []);

  const closeCompose = useCallback(() => {
    setState({ open: false, replyTo: null });
  }, []);

  return (
    <ComposeContext.Provider value={{ openCompose, closeCompose }}>
      {children}
      {state.open && <ComposeDialog replyTo={state.replyTo} onClose={closeCompose} />}
    </ComposeContext.Provider>
  );
}

function ComposeDialog({ replyTo, onClose }: { replyTo: ComposeReplyTo | null; onClose: () => void }) {
  const session = useSession();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ESC で閉じる、背面スクロールをロック
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [loading, onClose]);

  const agent = session.agent;
  if (!agent) {
    // 非サインイン時は開かない想定だが念のため
    return null;
  }

  async function submit() {
    const body = text.trim();
    if (!body || body.length > 300 || loading || !agent) return;
    setLoading(true);
    setErr(null);
    try {
      const reply: ReplyRef | undefined = replyTo
        ? { root: replyTo.root, parent: replyTo.parent }
        : undefined;
      await createPost(agent, body, reply);
      setText('');
      // 投稿直後に解析 (行動分類 → questLog 更新 → rpgStats 更新) を走らせる。
      // 結果は UI 側 (ホーム / /spirit) が useOnPosted で再フェッチするので、ここで
      // 保存までやり切ってから notifyPosted する。失敗してもクローズは続行。
      if (session.did) {
        try {
          await processSelfPost(agent, session.did, body);
        } catch (e) {
          console.warn('post-processor failed', e);
        }
      }
      notifyPosted();
      onClose();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.currentTarget === e.target && !loading) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1em',
        zIndex: 100,
      }}
    >
      <div
        className="dq-window"
        style={{
          width: 'min(440px, 100%)',
          margin: 0,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4em' }}>
          <h3 style={{ margin: 0, fontSize: '1em' }}>{replyTo ? '返信' : '投稿する'}</h3>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label="閉じる"
            title="閉じる"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-fg)',
              fontSize: '1.2em',
              padding: '0 0.3em',
              boxShadow: 'none',
            }}
          >
            ✕
          </button>
        </div>

        {replyTo && (
          <div
            style={{
              padding: '0.5em 0.7em',
              borderLeft: '3px solid var(--color-accent)',
              background: 'rgba(255, 255, 255, 0.06)',
              borderRadius: 2,
              marginBottom: '0.5em',
              fontSize: '0.85em',
            }}
          >
            <div style={{ color: 'var(--color-muted)', fontSize: '0.8em' }}>@{replyTo.author} への返信</div>
            <div style={{ marginTop: '0.3em', whiteSpace: 'pre-wrap' }}>{replyTo.text}</div>
          </div>
        )}

        <TextField
          multiline
          submitWithModifier
          value={text}
          onChange={setText}
          onSubmit={submit}
          style={{ width: '100%', minHeight: '7em', padding: '0.5em', fontSize: '1em' }}
          placeholder={replyTo ? '返信を書く' : 'いまどうしてる?'}
          maxLength={300}
          disabled={loading}
          autoFocus
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5em' }}>
          <span style={{ fontSize: '0.85em', color: text.length > 300 ? 'var(--color-danger)' : 'var(--color-muted)' }}>
            {text.length} / 300
          </span>
          <div style={{ display: 'flex', gap: '0.4em' }}>
            <button className="secondary" onClick={onClose} disabled={loading}>キャンセル</button>
            <button onClick={submit} disabled={!text.trim() || text.length > 300 || loading}>
              {loading ? '送信中...' : replyTo ? '返信する' : 'ポスト'}
            </button>
          </div>
        </div>
        {err && <p style={{ color: 'var(--color-danger)', marginTop: '0.5em', fontSize: '0.85em' }}>{err}</p>}
      </div>
    </div>
  );
}
