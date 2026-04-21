import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { createPost } from '@/lib/atproto';

export function Compose() {
  const session = useSession();
  const navigate = useNavigate();
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
      await createPost(agent, text);
      navigate('/', { replace: true });
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>投稿作成</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', minHeight: '8em', padding: '0.5em', fontSize: '1em' }}
        placeholder="いまどうしてる?"
        maxLength={300}
        disabled={loading}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5em' }}>
        <span style={{ fontSize: '0.85em', color: text.length > 300 ? '#b00' : 'var(--color-muted)' }}>
          {text.length} / 300
        </span>
        <button onClick={submit} disabled={!text.trim() || text.length > 300 || loading}>
          {loading ? '送信中...' : 'ポスト'}
        </button>
      </div>
      {err && <p style={{ color: '#b00', marginTop: '0.5em' }}>{err}</p>}
    </div>
  );
}
