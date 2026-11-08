import { SLM_LICENSE_URL } from '@/lib/slm-wgsl/weights';
import { PrivacyVoiceCredit } from '@/components/voice/voice-toggle';

export function Privacy() {
  return (
    <div>
      <h2>プライバシーポリシー</h2>
      <p>Aozora Quest はユーザーの個人情報を一切運営サーバーに保持しません。</p>
      <ul>
        <li>診断結果・クエスト進捗・旅の仲間リストはユーザーの AT Protocol PDS にのみ保存されます。</li>
        <li>LLM 推論はブラウザ内で完結します (Chrome の Gemini Nano、WebGPU で動く分類・埋め込みモデル)。投稿内容を外部 LLM API に送信しません。</li>
        <li>Gemini Nano の無い端末では、カードの文と投稿の翻訳に、端末内で動くブルスコン（言語モデル LFM2.5-1.2B-JP、初回のみ約660MB をダウンロード）を使うことがあります。処理は端末内で行い、外部に送信しません。</li>
        <li>Blueskyちゃんの声 (設定で ON にしたときだけ) は、端末の中で音声合成します。セリフを外部に送信しません。初回のみ声のデータ (約41MB) をダウンロードします。</li>
        <li>解析サービス・トラッキング・Cookie の利用はありません。</li>
        <li>発見 ON にしたユーザーの DID は、主管理者 DID の PDS に公開レコードとして掲載されます。</li>
      </ul>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        ブルスコンの中身: LFM2.5-1.2B-JP-202606 (Liquid AI) を変換して使用。
        <a href={SLM_LICENSE_URL} target="_blank" rel="noopener noreferrer">LFM Open License v1.0</a>
      </p>
      <PrivacyVoiceCredit />
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>最終更新: 2026-11-06</p>
    </div>
  );
}
