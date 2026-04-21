import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminSession } from '@/lib/session';

/**
 * SessionProvider 側で init() を走らせるので、ここで二重呼び出ししない。
 * signed-in になったのを見届けてから '/' に遷移する。
 */
export function OAuthCallback() {
  const navigate = useNavigate();
  const session = useAdminSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'signed-in') {
      navigate('/', { replace: true });
      return;
    }
    if (session.status === 'signed-out') {
      setError('認可サーバーからの応答を処理できませんでした。最初からやり直してください。');
    }
  }, [session.status, navigate]);

  return (
    <div>
      {error ? (
        <>
          <h2>認証エラー</h2>
          <p style={{ color: '#b00' }}>{error}</p>
          <button onClick={() => navigate('/')}>戻る</button>
        </>
      ) : (
        <p>認証中...</p>
      )}
    </div>
  );
}
