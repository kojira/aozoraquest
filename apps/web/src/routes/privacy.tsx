export function Privacy() {
  return (
    <div>
      <h2>プライバシーポリシー</h2>
      <p>Aozora Quest はユーザーの個人情報を一切運営サーバーに保持しません。</p>
      <ul>
        <li>診断結果・クエスト進捗・旅の仲間リストはユーザーの AT Protocol PDS にのみ保存されます。</li>
        <li>LLM 推論はブラウザ内で完結します (Chrome の Gemini Nano、ONNX/WASM の埋め込みモデル)。投稿内容を外部 LLM API に送信しません。</li>
        <li>解析サービス・トラッキング・Cookie の利用はありません。</li>
        <li>発見 ON にしたユーザーの DID は、主管理者 DID の PDS に公開レコードとして掲載されます。</li>
      </ul>
    </div>
  );
}
