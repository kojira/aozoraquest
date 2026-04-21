import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/lib/session';

/**
 * OAuth 認可サーバーから戻ってきた先。
 *
 * SessionProvider 側で restoreSession() → client.init() を走らせていて、
 * URL に code があれば自動でトークン交換される。ここでは **init() を重ねて呼ばず**、
 * SessionProvider が signed-in に遷移するのを待ってから '/' に遷移する。
 * (二重 init() はセッション保存書き込みとレースして signed-out で固定する原因になる)
 */
export function OAuthCallback() {
  const navigate = useNavigate();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'signed-in') {
      navigate('/', { replace: true });
      return;
    }
    if (session.status === 'signed-out') {
      // SessionProvider が loading → signed-out に落ちたのは、トークン交換失敗を意味する
      setError('認可サーバーからの応答を処理できませんでした。最初からやり直してください。');
    }
  }, [session.status, navigate]);

  return (
    <div>
      {error ? (
        <>
          <h2>認証エラー</h2>
          <p style={{ color: '#b00' }}>{error}</p>
          <button onClick={() => navigate('/onboarding')}>最初から</button>
        </>
      ) : (
        <p>認証中...</p>
      )}
    </div>
  );
}
