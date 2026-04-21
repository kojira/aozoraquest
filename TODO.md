# TODO / 未実装一覧

このドキュメントは「設計としては想定しているが、まだコードが追いついていない項目」を記録する。実装が完了したら削除するか `(実装済み YYYY-MM-DD)` の印を付ける。

最終更新: 2026-04-21

## 中核機能 (ゲーム進行)

### クエスト進捗検出 ← 今まさに実装中
- 投稿本文を分類して該当クエストの `currentCount` を更新する機構
- 現状: `generateDailyQuests` が 3 件のクエストを生成するだけで、進捗は常に 0
- 実装予定:
  - `packages/prompts/actions/*.json` に行動プロトタイプ (6 種 × 8 件)
  - `scripts/build-prototypes.ts` 拡張で `.bin` を生成
  - `apps/web/src/lib/action-classifier.ts` (埋め込み類似度で分類)
  - `apps/web/src/lib/post-processor.ts` (投稿直後に classify → questLog 更新)
  - `useOnPosted` から post-processor を呼ぶ
  - `app.aozoraquest.questLog` にレコードを書き込み (レキシコンは既存)

### レーダーチャート即時更新
- 投稿の行動分類結果から `ACTION_WEIGHTS` を適用、rpgStats を更新
- 現状: diagnosis 結果の静的な `rpgStats` のみ。新しい投稿は反映されない
- 実装予定: post-processor で analysis.rpgStats を書き換える (上限 100、合計正規化)

### XP / レベル
- `packages/core/src/quest.ts` の `levelFromXp` は実装済みだが、累計 XP を保存する場所がない
- クエスト達成時 (`currentCount === requiredCount` に到達した瞬間) の XP 加算ロジックも未実装
- 実装予定: `app.aozoraquest.questLog` に `totalXpGained` フィールドを追加、達成判定で加算

### 転職 (ジョブ変更)
- `job.eligible` のトリガが未実装。現在のステータス形と目標ジョブの形が一定以上近づいたら「転職できる」通知
- 実装予定: 診断と同様に `currentJob` を走らせて score >= 0.85 で eligible、専用 UI

### ストリーク (連続投稿日数)
- `streak.milestone` のセリフは準備済みだが、streak 計算ロジックが未実装
- 実装予定: 自分の投稿の日次分布を走査、連続日数を計算、PDS に永続化

## ブラウザ LLM 関連

### モバイル WebGPU 検証
- TinySwallow q4f16 が iOS / Android Safari / Chrome でどう動くか未検証
- 実装予定: 実機で試す。遅すぎるなら WASM フォールバックの検討

### WASM フォールバック
- WebGPU が使えない環境で現在は儀式エラーになる
- 実装予定: 低品質でも走る WASM パス (生成は遅い前提で割り切る)

### 生成品質調整
- system prompt、temperature、repetition_penalty の微調整は未着手
- 実装予定: 何度か対話してみて、ブルスコンの口調が設定通りかレビュー

## 共鳴タイムライン

### ディレクトリ自動同期
- 管理者が手動で「検索から更新」を押すまで新しい opt-in ユーザーが反映されない
- 実装予定: 定期的に (ローカル cron 的に) 走らせる仕組み or 自分が開くたびに裏で軽く走らせる

### 共鳴スコアランキングの精度
- 現状は diag.rpgStats のみでスコア計算。投稿内容の類似性は見ていない
- 実装予定 (遠い): 投稿埋め込みの中心コサイン類似度も加味

## UI / UX

### 通知タブ
- `notifications.tsx` は stub
- 実装予定: `agent.app.bsky.notification.listNotifications` を叩いて表示

### 投稿詳細ページ (`/post/:uri`)
- `post-detail.tsx` は stub
- 実装予定: スレッド表示 + 返信入力 (compose-modal と統合)

### プロフィール詳細
- 共鳴スコア表示は入れたが、以下未実装:
  - フォロー / フォロワー一覧
  - 共通の仲間 (companion)
  - 相手のレーダーチャートとの重ね合わせ表示の強調

### 投稿作成時の facet (メンション / タグ / リンク)
- ComposeModal は plain text のみ。ハッシュタグや URL を入力しても自動 facet 化されない
- 実装予定: テキストから URL / mention / hashtag を検出して facets 配列を構築

### 画像投稿 / OGP
- 未対応

### スレッド無限スクロール
- profile.tsx の最近の投稿は 10 件固定
- spirit chat も 50 件固定
- 実装予定: VirtualFeed に載せ替え

## Admin

### 変更履歴タブ (`/history`)
- stub のまま
- 実装予定: admin の PDS に書き込んだレコードの変更履歴を表示

### プロンプトの履歴保持
- 1 本の rkey=spiritChat のみ、過去版は消える
- 実装予定: rkey に timestamp を入れて履歴保持、管理 UI で戻せるように

### 監査ログ
- 設計書 (14-admin.md) にあるが未実装
- 実装予定: 管理者操作のログレコード (rkey=tid で append-only)

## インフラ / デプロイ

### Cloudflare Pages デプロイパイプライン
- 現状ローカル dev のみ
- 実装予定: GitHub Actions で web / admin を別プロジェクトにデプロイ

### プロダクション OAuth クライアントメタデータ
- `public/client-metadata.json` が存在するが内容が空 / 未検証
- 実装予定: 本番ドメイン確定後に正しい client_metadata で配信

### Ruri-v3 プロトタイプの事前 embed の CI 化
- `scripts/build-prototypes.ts` は手元でしか走らない
- 実装予定: ビルド時に自動実行 (もしくは生成済み bin をリポジトリに commit)

## テスト

### E2E 認証テスト
- OAuth フローは手動でしかテストしていない
- 実装予定: Playwright で (スタブ PDS 相手に) 認証テスト。但し実装コスト高

### 召喚儀式のスクリーンショット / 映像テスト
- アニメーションが期待通りかの回帰テスト手段がない
- 実装予定: Playwright でフェーズ遷移の DOM アサート + スクショ

## ドキュメント

- `docs/11-validation.md` は実験計画のみで実施結果がまだ一部空欄
- `docs/13-ops.md` は新設したが運用手順の具体例が薄い
- プライバシーポリシーと ToS は雛形のまま、連絡先・責任範囲の明記が必要

## 小さい未対応

- `apps/admin/src/routes/history.tsx` は stub
- `apps/web/src/routes/privacy.tsx` / `tos.tsx` は雛形
- `SessionProvider` の token refresh 処理 (長期ログインで失効した時の挙動)
- ネット切断時の再試行 UI (post-metrics の like/repost は出す、チャットは出す、他未徹底)
