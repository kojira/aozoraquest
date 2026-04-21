import { useParams } from 'react-router-dom';

export function Profile() {
  const { handle } = useParams<{ handle: string }>();
  return (
    <div>
      <h2>@{handle}</h2>
      <p style={{ color: 'var(--color-muted)' }}>他ユーザープロフィール。実装中。</p>
    </div>
  );
}
