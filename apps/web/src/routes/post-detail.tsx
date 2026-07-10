import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PostThread } from '@/components/post-thread';

/**
 * /profile/:handle/post/:rkey の全画面表示 (共有 URL の直開き用)。
 * アプリ内のタップ遷移は基本カラム内ドリルダウン (column-detail.tsx) で表示され、
 * このルートは主に外部から共有された URL を直接開いたときに使われる。
 */
export function PostDetail() {
  const { handle, rkey } = useParams<{ handle: string; rkey: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // 直前に居た場所へ戻す (アプリ内履歴があれば pop、無ければホームへ)。
  const canGoBack = location.key !== 'default';

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
      <PostThread handle={handle ?? ''} rkey={rkey ?? ''} />
    </div>
  );
}
