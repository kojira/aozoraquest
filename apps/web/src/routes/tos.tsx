export function Tos() {
  return (
    <div>
      <h2>利用規約</h2>
      <p>Aozora Quest は Bluesky のサードパーティクライアントです。</p>
      <ul>
        <li>本アプリは無料で、商用化しません。</li>
        <li>LLM 推論はブラウザ内で完結します (Chrome の Gemini Nano)。生成系機能を使うブラウザに対応していない場合、その機能は自動的に無効化されます。</li>
        <li>Gemini Nano の無い端末では、投稿の翻訳に端末内の翻訳モデル (sarashina2.2-0.5b、初回のみ約 430MB をダウンロード) を使うことがあります。翻訳は端末内で行い、投稿内容を外部に送信しません。</li>
        <li>BAR ブルスコ (利用者が集う TL) のために主管理者 DID の PDS から公開コンフィグを読み取ります。</li>
        <li>気質診断は Bluesky 公開投稿のみを対象とし、ブラウザ内で完結します。</li>
      </ul>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>最終更新: 2026-05-27</p>
    </div>
  );
}
