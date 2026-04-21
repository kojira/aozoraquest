export function Dashboard() {
  return (
    <div>
      <h2>概要</h2>

      <div className="section">
        <h3>システム状態</h3>
        <p>メンテナンス: 🟢 OFF / 現行バージョン: <code>v0.1.0-dev</code></p>
      </div>

      <div className="section">
        <h3>直近 7 日</h3>
        <p style={{ color: 'var(--color-muted)' }}>
          Cloudflare Web Analytics 埋め込み予定。(実装中)
        </p>
      </div>

      <div className="section">
        <h3>Quick Actions</h3>
        <p style={{ color: 'var(--color-muted)' }}>
          各機能は左サイドバーから。デプロイ / ロールバックは外部 UI (GitHub Actions / Cloudflare Pages)。
        </p>
      </div>
    </div>
  );
}
