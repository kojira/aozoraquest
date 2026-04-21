export function Privacy() {
  return (
    <div>
      <h2>プライバシーポリシー</h2>
      <p>Aozora Quest はユーザーの個人情報を一切運営サーバーに保持しません。</p>
      <ul>
        <li>診断結果・クエスト進捗・旅の仲間リストはユーザーの AT Protocol PDS にのみ保存されます。</li>
        <li>BYOK で外部 LLM を使う場合、プロンプト・投稿内容は選択したプロバイダー (Anthropic / OpenRouter) に送信されます。</li>
        <li>Cloudflare Web Analytics で匿名の集計データのみ取得します (PII なし、Cookie なし)。</li>
        <li>発見 ON にしたユーザーの DID は、主管理者 DID の PDS に公開レコードとして掲載されます。</li>
      </ul>
    </div>
  );
}
