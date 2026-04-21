import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn } from '@/lib/oauth';
import { useSession } from '@/lib/session';

export function Onboarding() {
  const session = useSession();
  const navigate = useNavigate();
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSignIn() {
    setErr(null);
    setLoading(true);
    try {
      await signIn(handle.trim());
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setLoading(false);
    }
  }

  if (session.status === 'loading') return <p>セッション確認中...</p>;

  if (session.status === 'signed-in') {
    return (
      <div>
        <h2>ようこそ、{session.handle}</h2>
        <p>すでにログイン済みです。</p>
        <button onClick={() => navigate('/me')}>自分のプロフィールへ</button>
      </div>
    );
  }

  return (
    <div>
      <h2>Aozora Quest へようこそ</h2>
      <p style={{ color: 'var(--color-muted)' }}>
        Bluesky のハンドル (例: yourname.bsky.social) を入力してログインしてください。
      </p>
      <div style={{ marginTop: '1em' }}>
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="yourname.bsky.social"
          style={{ width: '100%', padding: '0.6em', fontSize: '1em' }}
          disabled={loading}
        />
      </div>
      <button
        onClick={onSignIn}
        disabled={!handle.trim() || loading}
        style={{ marginTop: '1em', padding: '0.6em 1.2em' }}
      >
        {loading ? 'リダイレクト中...' : 'Bluesky でログイン'}
      </button>
      {err && <p style={{ color: '#b00', marginTop: '1em' }}>{err}</p>}
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginTop: '2em' }}>
        認証は Bluesky の OAuth (DPoP バインド) を使います。Aozora Quest がパスワードを扱うことはありません。
      </p>
    </div>
  );
}
