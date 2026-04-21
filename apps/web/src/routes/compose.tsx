import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { createPost, type ReplyRef } from '@/lib/atproto';
import { TextField } from '@/components/text-field';

interface ReplyToState {
  parent: { uri: string; cid: string };
  root: { uri: string; cid: string };
  author: string;
  text: string;
}

export function Compose() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const replyTo = (location.state as { replyTo?: ReplyToState } | null)?.replyTo;

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (session.status !== 'signed-in' || !session.agent) {
    return (
      <div>
        <p>ログインが必要です。</p>
        <button onClick={() => navigate('/onboarding')}>ログイン</button>
      </div>
    );
  }

  const agent = session.agent;

  async function submit() {
    if (!text.trim() || text.length > 300) return;
    setLoading(true);
    setErr(null);
    try {
      const reply: ReplyRef | undefined = replyTo
        ? { root: replyTo.root, parent: replyTo.parent }
        : undefined;
      await createPost(agent, text, reply);
      navigate('/', { replace: true });
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>{replyTo ? '返信' : '投稿作成'}</h2>

      {replyTo && (
        <div
          style={{
            padding: '0.6em 0.8em',
            borderLeft: '3px solid var(--color-accent)',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 2,
            marginBottom: '0.6em',
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
        style={{ width: '100%', minHeight: '8em', padding: '0.5em', fontSize: '1em' }}
        placeholder={replyTo ? '返信を書く' : 'いまどうしてる?'}
        maxLength={300}
        disabled={loading}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5em' }}>
        <span style={{ fontSize: '0.85em', color: text.length > 300 ? '#b00' : 'var(--color-muted)' }}>
          {text.length} / 300
        </span>
        <button onClick={submit} disabled={!text.trim() || text.length > 300 || loading}>
          {loading ? '送信中...' : replyTo ? '返信する' : 'ポスト'}
        </button>
      </div>
      {err && <p style={{ color: '#b00', marginTop: '0.5em' }}>{err}</p>}
    </div>
  );
}
