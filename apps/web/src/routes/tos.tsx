export function Tos() {
  return (
    <div>
      <h2>利用規約</h2>
      <p>Aozora Quest は Bluesky のサードパーティクライアントです。</p>
      <ul>
        <li>本アプリは無料で、商用化しません。</li>
        <li>LLM 推論はブラウザ内で完結します (Chrome の Gemini Nano)。生成系機能を使うブラウザに対応していない場合、その機能は自動的に無効化されます。</li>
        <li>BAR ブルスコ (利用者が集う TL) のために主管理者 DID の PDS から公開コンフィグを読み取ります。</li>
        <li>気質診断は Bluesky 公開投稿のみを対象とし、ブラウザ内で完結します。</li>
      </ul>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>最終更新: 2026-05-27</p>
    </div>
  );
}
