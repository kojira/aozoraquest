# 13 - 運用 (CI/CD、監視、セキュリティ、法務)

## 方針

Aozora Quest は**バックエンドレス**のため、運用は以下だけに絞られる:

1. **CI/CD**: GitHub → Cloudflare Pages の自動デプロイ (本体 PWA + 管理画面、2 プロジェクト)
2. **モニタリング**: Cloudflare Web Analytics (匿名集計のみ、PII なし)
3. **シークレット管理**: BYOK 関連の秘匿 (ユーザー各自)、管理者の OAuth クレデンシャル
4. **法務**: 商標性のある性格類型論表記を使わない、AT Protocol ToS、Cloudflare ToS

サーバーを持たないので、典型的な「インフラ運用」(スケーリング、DB、監視エージェント) は一切ない。

---

## CI/CD (GitHub Actions → Cloudflare Pages)

### リポジトリ構造とブランチ戦略

- `main` ブランチ = 本番相当 (Cloudflare Pages の production)
- PR は `feature/*` → `main` への merge で運用
- タグ `v*.*.*` でリリース扱い

### Cloudflare Pages プロジェクト (2 つ)

| プロジェクト | ドメイン | Build 対象 |
|---|---|---|
| `aozoraquest-web` | `aozoraquest.app` | `apps/web` |
| `aozoraquest-admin` | `admin.aozoraquest.app` | `apps/admin` |

Cloudflare Pages の GitHub 連携で、push / PR preview が自動発動。

### ワークフロー (`.github/workflows/ci.yml`)

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test

  e2e:
    runs-on: ubuntu-latest
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install chromium --with-deps
      - run: pnpm test:e2e
```

Cloudflare Pages の build 設定は UI で登録 (09-tech-stack.md §本番ビルド参照)。CI は test/lint の gating、deploy は Pages 側が担当。

### 手動デプロイ (管理ダッシュボードから)

14-admin.md §(g) GitHub タグデプロイ — 実体は **GitHub Actions の manual dispatch** を admin.aozoraquest.app の UI から開く導線。Actions 側で以下を動かす:

```yaml
# .github/workflows/deploy-web.yml
on:
  workflow_dispatch:
    inputs:
      ref:
        description: 'Git ref (tag or branch)'
        required: true
        default: 'main'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { ref: ${{ inputs.ref }} }
      # ... build + push to Cloudflare Pages via wrangler or Pages API
```

## モニタリング

### Cloudflare Web Analytics (唯一の監視)

- Cloudflare Pages の設定で Web Analytics を有効化
- クライアントサイドスクリプト不要 (サーバーサイド計測)
- 取得項目: PV、ユニーク訪問 (匿名)、国別、デバイス、Core Web Vitals
- PII なし、Cookie なし

管理ダッシュボード (14-admin.md §(i)) からダッシュボード URL に遷移して閲覧。

### エラートラッキング

**採用しない**。理由:

- Sentry 等は外部サーバーにエラー情報を送信、プライバシー原則と衝突
- Cloudflare の standard logs で十分 (サーバー 404 等)
- クライアントサイドの JS エラーは、将来必要なら自前で主管理者 PDS に匿名投稿する機構を実装

## シークレット管理

### CI/CD で必要なシークレット

GitHub Actions repository secrets に登録:

| 名前 | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Pages デプロイ (Pages Edit スコープのみ) |
| `CLOUDFLARE_ACCOUNT_ID` | 同上 |

**ローテーション**: 年 1 回程度の見直しで十分 (ボトルネックではない)。漏洩が判明したら即座に revoke、新規発行。

### ユーザー側の BYOK キー

- ユーザーの IndexedDB に AES-GCM で暗号化保存 (09-tech-stack.md §セキュリティ)
- 運営者は一切触れない
- 流出経路は XSS 以外なし (CSP で対策)

### 管理者 OAuth

- 主管理者の Bluesky アカウントで OAuth ログイン
- DPoP バインドの access token は IndexedDB 内でセッション管理
- 開発者は管理者アカウントの資格情報を共有しない (14-admin.md §チーム招待 非対応)

## セキュリティ運用

### CSP レビュー

09-tech-stack.md §CSP に定義済みの CSP を、外部依存が増えるたびに見直す。特に:

- 新しい CDN を追加するとき
- 新しい LLM プロバイダーを追加するとき (OpenRouter 以外)
- Cloudflare Analytics 以外の計測を入れないこと

### 依存性監査

- `pnpm audit` を CI に組み込み、high/critical が出たら PR を停止
- 四半期ごとに `pnpm update --interactive` で major 更新を検討
- `@huggingface/transformers`、`@atproto/api` は特に注視 (コア依存)

### リスク対応プロセス

CVE が公開された依存を使っている場合:

1. 影響範囲を評価 (クライアントサイドのみか、広告経路か等)
2. 暫定で CSP / 機能無効化で回避可能か検討
3. パッチ版にアップデート → テスト → デプロイ
4. 14-admin.md の監査ログに記録

## 法務チェック

### 商標性のある表記の排除

01-overview.md §設計原則 6 のとおり。

- UI・ソース・ドキュメント・データファイルから、商標性のある 4 文字コード体系および商標登録された人名由来の名称を完全排除
- 内部識別子は独自 RPG ジョブ名 (`sage`, `explorer`, `miko` など)
- **自動チェック**: CI で grep し、該当パターンが含まれていたら fail

```bash
# scripts/check-trademark.sh — CI で走らせる
PATTERNS='\b([IE][NS][TF][JP])\b'   # 4 文字コード
if grep -rE "$PATTERNS" \
  apps/web/src apps/admin/src packages/ scripts/ docs/ README.md; then
  echo "FAIL: trademark-like 4-letter code detected"
  exit 1
fi
```

### AT Protocol ToS

- Bluesky の公式 ToS を遵守
- 公式クライアントと区別される旨を利用規約に明記 (`/tos`)
- Bluesky AppView の rate limit を尊重 (クライアント側でエクスポネンシャルバックオフ)

### 個人情報 / GDPR / APPI

- ユーザーの個人情報はすべて AT Protocol PDS に保存 (= Bluesky または自己ホストの PDS)
- **Aozora Quest 運営者は PII を一切保持しない**
- 法務上の「データ保持者」は Bluesky または当該 PDS 運営者
- Cloudflare Web Analytics は Cookie / PII なしなので GDPR 問題なし

### プライバシーポリシー / 利用規約

- `/privacy` と `/tos` の静的ページで掲示
- 要明記: BYOK キーの保管場所、外部 LLM プロバイダーへのデータ送信 (BYOK 時)、管理者 PDS への公開コンフィグ読み取り、共鳴 TL のためのディレクトリ利用

## バックアップ / 復旧

### バックエンドレスゆえのシンプルさ

- ユーザーデータ: PDS 側のバックアップに依存 (Bluesky 運営または self-hosted PDS 管理者の責任)
- 運用コンフィグ: 主管理者 PDS のコミット履歴に自動保存 (AT Protocol の仕組み)
- 静的アセット: GitHub にソースがある、ビルド成果物は Cloudflare Pages が履歴保持

### 障害復旧プロセス

| 障害 | 対応 |
|---|---|
| aozoraquest.app が落ちた | Cloudflare Pages の deployments からロールバック (14-admin.md §(h) 参照) |
| 主管理者 PDS が落ちた | アプリはデフォルト値でフォールバック起動、PDS 復旧を待つ (Bluesky 公式 PDS なら通常数時間) |
| Cloudflare が大規模障害 | 静的配信不能 → ユーザーは既存ブラウザキャッシュで動く。新規アクセスは待機 |
| 主管理者アカウント乗っ取り | 被害範囲調査 → ADMIN_DIDS から除外して再デプロイ → コンフィグレコードを前バージョンに revert |

## コスト見積

| 項目 | 月額見積 |
|---|---|
| Cloudflare Pages (本体 + 管理画面、2 プロジェクト) | **$0** (Free プラン: 500 ビルド/月、100GB 転送/月) |
| ドメイン (aozoraquest.app) | $10/年 ÷ 12 ≈ **$0.83** |
| モニタリング (Cloudflare Analytics) | **$0** |
| 合計 | **< $1/月** |

スケールしても Cloudflare の有料プランで月 $20 程度が上限目安。商用化しない前提 (01-overview.md §収益モデル) のためコストは最小化。

## 非ゴール

- **独自のエラートラッキングサービス** (Sentry など): プライバシー原則に反するため不採用
- **APM / 継続的監視**: クライアントサイドのみなので監視対象が少ない
- **24 時間オンコール体制**: 商用でもバックエンドもないので不要、緊急時は主管理者の対応で十分
- **GDPR 明示的同意フロー**: PII を保持しないので Cookie Consent Banner も不要
