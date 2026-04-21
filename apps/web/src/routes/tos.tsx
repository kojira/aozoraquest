export function Tos() {
  return (
    <div>
      <h2>利用規約</h2>
      <p>Aozora Quest は Bluesky のサードパーティクライアントです。</p>
      <ul>
        <li>本アプリは無料で、商用化しません。</li>
        <li>外部 LLM 機能 (BYOK) を使う場合、API キーはブラウザ内に暗号化保存され、第三者に送信されません。</li>
        <li>共鳴タイムラインのために主管理者 DID の PDS から公開コンフィグを読み取ります。</li>
        <li>気質診断は Bluesky 公開投稿のみを対象とし、ブラウザ内で完結します。</li>
      </ul>
    </div>
  );
}
