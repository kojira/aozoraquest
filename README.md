# Aozora Quest

Bluesky クライアント + 気質診断 RPG。投稿を解析して 5 軸のステータスと 16 の気質 (ジョブ) で可視化し、精霊キャラクターと共に「なりたい自分」を目指すゲーム的な SNS クライアント。

- ドメイン: https://aozoraquest.app
- プラットフォーム: Web アプリ (Vite + React の SPA。将来的にネイティブアプリへ展開)
- データ保存: ユーザーの AT Protocol PDS
- LLM: ブラウザ内 (WebGPU) を主 — 埋め込み Ruri-v3-30m、生成 TinySwallow-1.5B q4 (候補)、BYOK で Claude / OpenRouter をオプション
- 方針: バックエンドレス、プライバシー第一、AT Protocol ネイティブ、商用化しない

## 設計文書

実装に必要な情報はすべて `docs/` 以下にある。

| ファイル | 内容 |
|---|---|
| [docs/01-overview.md](docs/01-overview.md) | プロジェクト全体像、コンセプト、設計原則 |
| [docs/02-architecture.md](docs/02-architecture.md) | システムアーキテクチャ、レイヤー、データフロー |
| [docs/03-game-design.md](docs/03-game-design.md) | 5 ステータス、16 ジョブ、クエスト、成長ループ |
| [docs/04-diagnosis.md](docs/04-diagnosis.md) | 気質診断のアルゴリズムと認知機能 |
| [docs/05-compatibility.md](docs/05-compatibility.md) | 他ユーザーとの共鳴 (相性) システム |
| [docs/06-spirit.md](docs/06-spirit.md) | 精霊キャラクターの人格とセリフ設計 |
| [docs/07-ui-design.md](docs/07-ui-design.md) | 画面レイアウトとインタラクション |
| [docs/08-data-schema.md](docs/08-data-schema.md) | PDS カスタムレキシコンの定義 |
| [docs/09-tech-stack.md](docs/09-tech-stack.md) | 技術選定と実装ガイドライン |
| [docs/10-roadmap.md](docs/10-roadmap.md) | MVP スコープと開発順序 |
| [docs/11-validation.md](docs/11-validation.md) | パラメータ検証プロトコル (Browser LLM 選定ほか) |
| [docs/12-testing.md](docs/12-testing.md) | テスト戦略 (Unit / Integration / E2E) |
| [docs/13-ops.md](docs/13-ops.md) | 運用 (CI/CD、モニタリング、セキュリティ、法務) |
| [docs/14-admin.md](docs/14-admin.md) | 管理者ダッシュボード設計 |

## データ定義

| ファイル | 内容 |
|---|---|
| [docs/data/jobs.json](docs/data/jobs.json) | 16 ジョブの配分と表示名 |
| [docs/data/action-weights.json](docs/data/action-weights.json) | 行動 × ステータス重み表 |
| [docs/data/tags.json](docs/data/tags.json) | タグ分類のプロトタイプ例 |

## 検証スクリプト

| スクリプト | 用途 |
|---|---|
| [scripts/validate-llm.ts](scripts/validate-llm.ts) | 埋め込みモデル 5 種の日本語分類精度ベンチ (Ruri-v3 採用確定、実験 1) |
| [scripts/validate-llm-gen-playwright.ts](scripts/validate-llm-gen-playwright.ts) | Playwright + Chromium WebGPU で生成 LLM を実機ベンチ |
| [scripts/validate-llm-cls-playwright.ts](scripts/validate-llm-cls-playwright.ts) | ゼロショット LLM 分類ベンチ (TinySwallow vs MiniLM 比較用) |
| [scripts/validate-llm-gemini.ts](scripts/validate-llm-gemini.ts) | Gemini クラウド API による分類ベースライン |
| [scripts/validate-llm-minilm-sweep.ts](scripts/validate-llm-minilm-sweep.ts) | 任意埋め込みモデルの閾値スイープ |
| [scripts/validate-llm-gen-harness.html](scripts/validate-llm-gen-harness.html) | 生成実測ハーネス (Playwright から駆動) |
| [scripts/validate-llm-cls-harness.html](scripts/validate-llm-cls-harness.html) | 分類実測ハーネス |
| [scripts/validate-llm-gen-browser.html](scripts/validate-llm-gen-browser.html) | 手動ブラウザ実測 UI (モバイル検証用) |
| [scripts/validate-llm-browser.html](scripts/validate-llm-browser.html) | 埋め込みの手動ブラウザ実測 |

詳細は [scripts/README.md](scripts/README.md)。ベンチマーク結果は [docs/data/llm-benchmark.md](docs/data/llm-benchmark.md) 他。

## 実装者へのメモ

この文書は「何を作るか」を定義する。「どう書くか」は実装者に委ねる。ただし以下の原則は守ること。

1. **サーバー層を作らない**。運用コンフィグは主管理者 DID の PDS に保存 (14-admin.md)、Cloudflare Pages 静的配信のみ
2. **ユーザーデータはすべて PDS に保存**。アプリは読み書きするレンズであってデータベースではない
3. **LLM 呼び出しはローカル優先**。埋め込みは Ruri-v3-30m ONNX、生成は TinySwallow q4 (WebGPU)
4. **ジョブ名は独自の RPG 名のみで表現する**。既存の商標性のある 4 文字体系に依拠する表記を UI / ソースに含めない
5. **プライバシー**: 投稿の内容が第三者サーバーを経由する処理を避ける
6. **商用化しない**。有料プランなし

## 関連資料

- AT Protocol: https://atproto.com
- Transformers.js: https://huggingface.co/docs/transformers.js
- Cloudflare Pages / Workers: https://developers.cloudflare.com
