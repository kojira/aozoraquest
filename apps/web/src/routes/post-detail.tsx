import { useParams } from 'react-router-dom';

export function PostDetail() {
  const { uri } = useParams<{ uri: string }>();
  return (
    <div>
      <h2>投稿詳細</h2>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.85em' }}>URI: {uri}</p>
    </div>
  );
}
