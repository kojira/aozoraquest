# scripts/

開発者用スクリプト。リポジトリのビルド / デプロイ本体ではなく、設計検証やデータ前処理などの補助ツール。

## validate-llm.ts

Browser LLM (埋め込みモデル) の日本語分類精度を検証する。11-validation.md §実験 1 のプロトコルを実装。

### 事前準備

1. 検証データを `docs/data/validation/` 配下に配置 (形式は `docs/data/validation/README.md` を参照)
2. 認知機能プロトタイプを `packages/prompts/cognitive/{Ni,Ne,Si,Se,Ti,Te,Fi,Fe}.json` に配置
3. タグプロトタイプは `docs/data/tags.json` を自動で流用 (または `packages/prompts/tags.json`)

### 実行

モノレポのルートから:

```bash
# 必要な依存をインストール (ルートで一度だけ)
pnpm add -D -w tsx @huggingface/transformers onnxruntime-node

# 実行
pnpm tsx scripts/validate-llm.ts
```

モノレポ未セットアップ時は単体で:

```bash
npm install --save-dev tsx @huggingface/transformers onnxruntime-node
npx tsx scripts/validate-llm.ts
```

初回はモデルのダウンロードで数分かかる (合計 1GB 超)。2 回目以降は HuggingFace のローカルキャッシュから読む。

### 出力

- stdout にサマリー表
- `docs/data/llm-benchmark.md` に詳細レポート (混同行列・F1 含む)

### 注意

- Node 環境は WASM バックエンドのため、レイテンシは参考値。**実ブラウザでの WebGPU レイテンシは `validate-llm-browser.html` で別途計測**
- 分類精度 (Top-1 / Top-3 / F1) はバックエンドを問わず同じなので、Node で十分

### 合格判定

合格基準 (11-validation.md §実験 1):

| 指標 | 閾値 |
|---|---|
| 認知機能 Top-3 精度 | 65% 以上 |
| タグ Top-1 精度 | 70% 以上 |
| 中立 false positive | 30% 以下 |
| p95 レイテンシ (WebGPU) | 100ms 以下 ※browser で計測 |
| p95 レイテンシ (WASM) | 500ms 以下 |
| モデルサイズ | 200MB 以下 |

すべて満たすモデルの中で最小のものを選ぶ。結果を `docs/data/llm-benchmark.md` の §結論 に記入し、`packages/core/src/embedding-config.ts` の `EMBEDDING_MODEL_ID` に反映する。

---

## validate-llm-browser.html

実ブラウザでの WebGPU レイテンシを計測する。

### 使い方

1. このファイルを HTTPS オリジンで配信 (例: ローカルなら `python3 -m http.server 8000`)
2. `http://localhost:8000/scripts/validate-llm-browser.html` をブラウザで開く
3. モデル / バックエンド / 試行数を選び「計測開始」
4. 結果を `docs/data/llm-benchmark.md` の該当列に手動で転記

### 注意

- 初回はモデルダウンロードに時間がかかる
- 2 回目以降はブラウザの IndexedDB キャッシュから読む
- **同一 PC の Chrome と Safari と Firefox で計測し、最悪値を採用する** (WebGPU 対応状況はブラウザで差がある)
