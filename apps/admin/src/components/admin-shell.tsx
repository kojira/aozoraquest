import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { getAdminDids, isAdmin } from '@/lib/admin';
import { useAdminSession } from '@/lib/session';
import { signIn, signOut } from '@/lib/oauth';

const nav = [
  { to: '/', label: '概要', end: true },
  { to: '/flags', label: 'フラグ' },
  { to: '/prompts', label: '精霊プロンプト' },
  { to: '/maintenance', label: 'メンテナンス' },
  { to: '/bans', label: 'BAN' },
  { to: '/directory', label: '発見ディレクトリ' },
  { to: '/history', label: '変更履歴' },
];

export function AdminShell() {
  const adminDids = getAdminDids();
  const session = useAdminSession();
  const [handleInput, setHandleInput] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (adminDids.length === 0) {
    return (
      <div className="gatekeep">
        <h2>設定エラー</h2>
        <p>VITE_ADMIN_DIDS が未設定です。ビルド時に環境変数で指定してください。</p>
      </div>
    );
  }

  if (session.status === 'loading') {
    return <div className="gatekeep"><p>セッション確認中...</p></div>;
  }

  if (session.status === 'signed-out') {
    return (
      <div className="gatekeep" style={{ padding: '2em', maxWidth: 480 }}>
        <h2>管理者ログイン</h2>
        <p style={{ color: 'var(--color-muted)' }}>
          登録された管理者 DID のみがログインできます。Bluesky のハンドルで認証。
        </p>
        <div style={{ display: 'flex', gap: '0.5em', marginTop: '1em' }}>
          <input
            value={handleInput}
            onChange={(e) => setHandleInput(e.target.value)}
            placeholder="example.bsky.social"
            style={{ flex: 1, padding: '0.5em' }}
            disabled={signingIn}
          />
          <button
            disabled={signingIn || !handleInput.trim()}
            onClick={async () => {
              setSigningIn(true);
              setErr(null);
              try {
                await signIn(handleInput.trim());
              } catch (e) {
                setErr(String((e as Error)?.message ?? e));
                setSigningIn(false);
              }
            }}
          >
            {signingIn ? '遷移中...' : 'ログイン'}
          </button>
        </div>
        {err && <p style={{ color: '#b00', marginTop: '0.5em' }}>{err}</p>}
        <p style={{ marginTop: '1em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
          登録管理者数: {adminDids.length}
        </p>
      </div>
    );
  }

  if (!isAdmin(session.did)) {
    return (
      <div className="gatekeep" style={{ padding: '2em', maxWidth: 480 }}>
        <h2>権限がありません</h2>
        <p>
          <code>{session.did}</code> は管理者 DID に登録されていません。
        </p>
        <button onClick={() => session.did && void signOut(session.did)}>ログアウト</button>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <h1>Aozora Quest · Admin</h1>
        <ul>
          {nav.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end ?? false}>{item.label}</NavLink>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: '2em', fontSize: '0.75em', color: 'var(--color-muted)' }}>
          <p>登録管理者 DID: {adminDids.length}</p>
          <p>ログイン中: {session.handle ?? session.did?.slice(0, 24) + '...'}</p>
          <button
            onClick={() => session.did && void signOut(session.did)}
            style={{ marginTop: '0.4em', fontSize: '0.9em' }}
          >
            ログアウト
          </button>
        </div>
      </nav>
      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
