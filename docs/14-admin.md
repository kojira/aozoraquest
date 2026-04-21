# 14 - 管理者ダッシュボード

## 位置づけ

Aozora Quest は「バックエンドレス」「ユーザーデータは PDS が正本」という原則で設計されている (01-overview.md §設計原則)。この原則を管理者機能にも貫くため、**管理者用のサーバーも用意しない**。運用コンフィグは管理者 DID の PDS に AT Protocol レコードとして保存し、クライアントは boot 時に管理者 PDS から直接読み取る。

管理対象は「**運用コンフィグと外部ツールへの導線**」に限定する。ユーザー個人のデータ (自分以外の PDS) は触らない。

## 管理者の定義

**ハードコードされた Bluesky DID のリスト** (`ADMIN_DIDS`) で識別する。

| 保存場所 | 形式 | 役割 |
|---|---|---|
| `apps/admin` / `apps/web` のビルド時定数 | `VITE_ADMIN_DIDS=did:plc:xxx,did:plc:yyy` | **主管理者** (コンフィグレコードの所有者) を先頭に、副管理者を後続で列挙 |

権限の正本は AT Protocol 自体が担う:
- 管理者 DID でログインした人だけが、その DID の PDS に `putRecord` できる (OAuth + DPoP)
- 他人が管理者 DID の PDS を書き換えることは不可能 (AT Protocol が保証)
- したがって「サーバー側の ADMIN_DIDS 認可チェック」は不要。クライアント側の ADMIN_DIDS 判定は UI ゲーティング (画面を出すか) のためだけに使う

### 複数管理者の扱い

すべての公開コンフィグは **主管理者** (ADMIN_DIDS の先頭) の PDS にのみ保存される。副管理者は主管理者の PDS を書き換えられないため、実質的には「編集画面を開ける人」に過ぎない。副管理者が実際に何かを変更するには、主管理者アカウントでログインし直す必要がある。

これで十分な理由:
- 商用化しないプロジェクトで、実質的な管理者は 1 人 (または少数のチーム)
- チームで共同編集したければ Bluesky アカウント自体の資格情報を共有する運用で対応可能 (非推奨だが、リスクは管理者チームが負う)
- 複数管理者で独立して書き換えたい需要が出たら、その時点で別仕組み (委任レコード等) を検討

## サブドメインとホスティング

### admin.aozoraquest.app

本体 `aozoraquest.app` とは別の **Cloudflare Pages プロジェクト** として配信する。理由:

1. **XSS の横展開遮断**: 本体が XSS 経路を持っても、本体 origin から管理 OAuth トークンを盗まれない
2. **デプロイ独立**: 管理画面の保守的な更新サイクルを本体のリリースと分離できる
3. **バンドル分離**: 管理者用コードが一般ユーザーに配信されない

本体も管理 SPA も、どちらも **Cloudflare Pages による静的配信のみ**。Cloudflare Worker は使わない。

### 推奨 CSP (admin.aozoraquest.app)

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self'
            https://plc.directory
            https://bsky.social
            https://*.bsky.network;
img-src 'self' https://cdn.bsky.app data:;
frame-ancestors 'none';
form-action 'self';
```

- `plc.directory`: DID → PDS エンドポイント解決
- `bsky.social` / `*.bsky.network`: AT Protocol PDS 呼び出し
- Claude / Anthropic は管理画面からは呼ばない (不要)
- Transformers.js / LLM は管理画面に不要 (`wasm-unsafe-eval` を含めない)

## モノレポ構成への追加

```
apps/
  web/                      既存 (本体 SPA、Vite + React)
  admin/                    新設 ★ (Vite + React)
    index.html
    src/
      main.tsx              エントリ、React Router 登録
      routes/
        dashboard.tsx       ダッシュボードトップ
        flags.tsx           フィーチャーフラグ
        prompts.tsx         システムプロンプト編集
        maintenance.tsx     メンテナンス制御
        bans.tsx            BAN リスト編集
        directory.tsx       発見ディレクトリ管理
        history.tsx         変更履歴
        oauth-callback.tsx
      components/
      lib/
    public/
      client-metadata.json  admin 用 OAuth クライアント
    vite.config.ts
    package.json

packages/
  core/                     既存
  lexicons/                 既存 + 追加: app.aozoraquest.config.* の 4 レキシコン + app.aozoraquest.directory
  types/                    既存
```

`apps/edge/` は存在しない (Worker 廃止)。

## 公開コンフィグのデータモデル

### 新設レキシコン (08-data-schema.md §管理者コンフィグ に定義)

| NSID | rkey | 内容 |
|---|---|---|
| `app.aozoraquest.config.flags` | `self` | フィーチャーフラグ全体 (シングルトン) |
| `app.aozoraquest.config.prompts` | 任意 (`spiritChat`, `draftPost` など) | システムプロンプト (ID ごと) |
| `app.aozoraquest.config.maintenance` | `self` | メンテナンスモードの状態 (シングルトン) |
| `app.aozoraquest.config.bans` | `self` | BAN DID リスト (シングルトン) |
| `app.aozoraquest.directory` | `self` | 共鳴タイムライン用の発見可能ユーザー DID リスト |

すべて**主管理者 DID の PDS にのみ置かれる**。一般ユーザーや副管理者は読み取り専用 (AT Protocol の仕様上そうなる)。

### クライアントでの読み取りフロー

```
1. クライアント起動 → ビルド時定数 ADMIN_DIDS の先頭 (主管理者 DID) を取得
2. 主管理者 DID を PLC ディレクトリ (plc.directory) で解決 → PDS エンドポイント
3. com.atproto.repo.getRecord で 4 つのコンフィグを並列取得
4. 取得結果をメモリに保持 (boot ごとに再取得、ランタイムのポーリングは行わない)
5. 失敗時は各コンフィグのデフォルト値で起動 (maintenance=false, flags=全 disabled, prompts=コード内の DEFAULT)
```

ランタイム中にコンフィグが更新されても、ユーザーが次に起動するまで反映されない。これは意図的な設計 (運用の静けさを優先)。

## 機能一覧

| # | 機能 | 操作対象 | MVP |
|---|---|---|---|
| a | フィーチャーフラグ編集 | `app.aozoraquest.config.flags` | ✓ |
| b | メンテナンスモード制御 | `app.aozoraquest.config.maintenance` | ✓ |
| c | システムプロンプト編集 | `app.aozoraquest.config.prompts` (rkey ごと) | ✓ |
| d | BAN リスト編集 | `app.aozoraquest.config.bans` | ✓ |
| e | **発見ディレクトリ管理** | `app.aozoraquest.directory` | ✓ |
| f | 変更履歴閲覧 | `com.atproto.sync.listRecords` の結果を表示 | ✓ |
| g | GitHub タグデプロイ | 外部 UI へのリンクのみ | ✓ (リンク) |
| h | バージョン切り替え | 外部 UI へのリンクのみ | ✓ (リンク) |
| i | 利用メトリクス | Cloudflare Web Analytics への埋め込み or 外部リンク | ✓ (リンク) |

## 機能詳細

### (a) フィーチャーフラグ編集

#### スキーマ (`app.aozoraquest.config.flags`)

```json
{
  "flags": {
    "compatibilityMap": { "enabled": true, "rollout": 100, "description": "共鳴マップ" },
    "pairTitles": { "enabled": false, "rollout": 0, "description": "ペア称号" }
  },
  "updatedAt": "2026-04-20T09:15:00Z"
}
```

#### クライアントでの評価

```typescript
function isEnabled(flag: string, userDid: string, flags: FlagConfig): boolean {
  const f = flags[flag];
  if (!f || !f.enabled) return false;
  if (f.rollout >= 100) return true;
  const bucket = hash(userDid) % 100;
  return bucket < f.rollout;
}
```

### (b) メンテナンスモード制御

#### スキーマ (`app.aozoraquest.config.maintenance`)

```json
{
  "enabled": false,
  "message": "メンテナンス中です。",
  "until": "2026-04-25T03:00:00Z",
  "allowedDids": ["did:plc:xxx"]
}
```

#### クライアントでの挙動

boot 時に `enabled=true` かつ自分の DID が `allowedDids` に含まれないなら、全画面メンテナンス UI を表示してアプリ機能を停止。管理者 DID は常に許可 (ADMIN_DIDS をクライアント側で参照)。

### (c) システムプロンプト編集

#### スキーマ (`app.aozoraquest.config.prompts`)

rkey を ID として各プロンプトを独立レコードに持つ:
- rkey = `spiritChat`: 精霊自由対話のシステムプロンプト
- rkey = `draftPost`: 投稿下書き生成のプロンプト (将来追加)

```json
{
  "id": "spiritChat",
  "body": "あなたは Aozora Quest の精霊です。青空の化身で、...",
  "notes": "2026-04-20 に口調を柔らかく調整",
  "updatedAt": "2026-04-20T09:15:00Z"
}
```

履歴は PDS のコミット履歴 (`com.atproto.sync.listRecords`) に自然に残る。ダッシュボードの (e) 変更履歴 機能で可視化。

#### クライアントでの利用 (BYOK)

LLM 呼び出し時、プロバイダーを問わず同じ system プロンプトを渡す (09-tech-stack.md §外部 LLM 呼び出し の `streamChat` 抽象):

```typescript
const prompt = configs.prompts.spiritChat?.body ?? DEFAULT_SPIRIT_PROMPT;
for await (const delta of streamChat(byokConfig, prompt, messages)) { /* ... */ }
```

`DEFAULT_SPIRIT_PROMPT` はアプリコード内に保持 (PDS 障害時・取得失敗時のフォールバック)。プロンプト本文はプロバイダー依存の表現を避けて書く (Anthropic / OpenRouter のどちらに渡しても破綻しないように)。

### (d) BAN リスト編集

#### スキーマ (`app.aozoraquest.config.bans`)

```json
{
  "dids": ["did:plc:spam1", "did:plc:spam2"],
  "notes": { "did:plc:spam1": "2026-04-15 bot 報告" },
  "updatedAt": "2026-04-20T09:15:00Z"
}
```

#### クライアントでの挙動

クライアントは boot 時に BAN リストを取得し、該当 DID の投稿をタイムラインから除外 / バッジ非表示。

**プライバシー注記**: このレコードは主管理者 PDS 上で公開されるため、BAN 対象 DID は誰でも見える。Bluesky のラベリングサービスと同じく「公開されるモデレーション情報」として扱う。

### (e) 発見ディレクトリ管理

共鳴タイムライン (05-compatibility.md §共鳴タイムライン) の発見元となる、オプトイン済みユーザー DID のリスト。主管理者 PDS の `app.aozoraquest.directory` (rkey=self) を編集する。

#### スキーマ

```json
{
  "users": [
    { "did": "did:plc:abc", "addedAt": "2026-04-20T09:15:00Z", "note": "..." }
  ],
  "updatedAt": "2026-04-20T09:15:00Z"
}
```

#### 追加のフロー

1. ユーザーが自分の設定画面で「発見 ON」にすると、`app.aozoraquest.profile.discoverable = true` が書き込まれる
2. ユーザーが管理者に連絡 (Bluesky の DM、メール、フォーム等) して追加希望を伝える
3. 管理者がダッシュボードで該当 DID の `discoverable` を確認し、ディレクトリに追加

**post-MVP**: Bluesky の jetstream をブラウザから購読して `app.aozoraquest.profile.discoverable = true` の書き込みを検知し、候補を半自動でサジェスト表示する (管理者がワンクリックで承認)。

#### UI

```
┌─────────────────────────────────────────────┐
│ 発見ディレクトリ ({N} 人)          [+ 追加] │
├─────────────────────────────────────────────┤
│ [検索: DID / ハンドル]                      │
├─────────────────────────────────────────────┤
│ did:plc:abc  @kaori.bsky   追加: 3 日前    │
│   note: "初期ユーザー"                      │
│   [プロフィール確認↗] [削除]                │
│ ─────────────────────────────               │
│ did:plc:def  @taro.bsky    追加: 5 日前    │
│   [プロフィール確認↗] [削除]                │
└─────────────────────────────────────────────┘
```

追加時のチェック: 対象 DID の `app.aozoraquest.profile.discoverable` が実際に `true` になっているか確認してから追加する (誤登録防止)。

### (f) 変更履歴閲覧

AT Protocol のコミット履歴から自動的に得られる。

```typescript
// com.atproto.sync.listRecords または getRepo で取得
const history = await agent.com.atproto.sync.listRecords({
  did: MAIN_ADMIN_DID,
  collection: 'app.aozoraquest.config.flags',
  limit: 50,
});
// history.records に各バージョンの cid と content が含まれる
```

ダッシュボード上では以下を表示:
- 変更日時 (PDS の indexedAt)
- 変更した NSID / rkey
- 差分 (前バージョンとの JSON diff)

「誰が」は常に主管理者 DID なので省略可能。

### (g) GitHub タグデプロイ

**ダッシュボードには機能を実装しない**。以下の導線のみ用意:

```
┌─────────────────────────────────────────────┐
│ デプロイ                                     │
│                                              │
│ デプロイは GitHub Actions から実行してください。│
│                                              │
│ [→ Actions を開く (web)]                     │
│ [→ Actions を開く (admin)]                   │
│                                              │
│ 最近のデプロイ履歴: (Cloudflare Pages)       │
│ [→ Pages ダッシュボードを開く]               │
└─────────────────────────────────────────────┘
```

リンクは GitHub の `/actions/workflows/deploy-{target}.yml` 画面に新タブで遷移。`workflow_dispatch` の手動実行は GitHub UI 側で行う。

### (h) バージョン切り替え (ロールバック)

同上、**外部 UI への導線のみ**:

```
┌─────────────────────────────────────────────┐
│ バージョン切り替え                           │
│                                              │
│ ロールバックは Cloudflare Pages から         │
│ 実行してください。                            │
│                                              │
│ [→ Pages: web プロジェクト]                  │
│ [→ Pages: admin プロジェクト]                │
└─────────────────────────────────────────────┘
```

Cloudflare Pages ダッシュボードの「Deployments」からワンクリックで過去のデプロイを再公開できる。

### (i) 利用メトリクス

Cloudflare Web Analytics のダッシュボードを iframe 埋め込み、または外部リンク:

```
┌─────────────────────────────────────────────┐
│ 利用メトリクス                               │
│                                              │
│ [Cloudflare Web Analytics を開く →]         │
│                                              │
│ (主な指標は Cloudflare 側で確認可能)        │
│ - DAU / MAU / ページビュー                  │
│ - 国別、デバイス別のサマリ                  │
│ - Core Web Vitals                           │
└─────────────────────────────────────────────┘
```

独自のロールアップは行わない (Worker がないため集計する場所がない)。

## 認証

### フロー

```
1. admin SPA に未ログインでアクセス
     ↓
2. @atproto/oauth-client-browser で Bluesky OAuth 開始
     ↓
3. ユーザーの PDS で認可 → DPoP バインドされた access token を取得
     ↓
4. SPA は VITE_ADMIN_DIDS に自分の DID が含まれるかで UI を分岐
     (含まれない場合は「運営専用」の静的メッセージを表示)
     ↓
5. 編集操作: agent.com.atproto.repo.putRecord を直接呼ぶ
     (自分の PDS なので他人は書けない = 権限検証は AT Protocol が担保)
```

### 破壊的操作の確認

以下は UI で typed confirm を必須にする:

- BAN リストへの DID 追加
- メンテナンスモード ON
- プロンプトの変更 (精霊の挙動に直接影響)

デプロイとロールバックは外部 UI 側の確認ダイアログに任せる。

## 脅威モデル

| 脅威 | 影響 | 緩和策 |
|---|---|---|
| 管理者アカウント乗っ取り | 全権掌握 | Bluesky 側の認証強化に依存 (app-specific password、将来の 2FA) |
| XSS による管理 OAuth トークン窃取 | コンフィグ改ざん | サブドメイン分離、CSP strict、外部スクリプト一切なし、依存ライブラリ最小化 |
| CSRF | 管理操作の不正呼び出し | DPoP 必須 (トークン単独では攻撃不可) |
| プロンプト編集の悪意ある改変 | Claude 出力の有害化 | `DEFAULT_SPIRIT_PROMPT` フォールバック、PDS コミット履歴で事後検知 |
| 管理者 PDS の障害 | 設定取得不能 | フォールバック既定値で起動 (maintenance=false, flags=全 disabled, prompts=DEFAULT) |

**消えた脅威** (Worker 廃止により):
- ~~GITHUB_DISPATCH_TOKEN の漏洩~~ (Worker に置かない)
- ~~CF_API_TOKEN の漏洩~~ (同上)
- ~~監査ログ改ざん~~ (AT Protocol のコミットは改ざん不能な cid チェイン)

## UI ワイヤーフレーム (ダッシュボードトップ)

```
┌─────────────────────────────────────────────────────┐
│ Aozora Quest · Admin     admin@did...    [Logout]   │
├─────────────────────────────────────────────────────┤
│ 状態                                                 │
│  メンテナンス: 🟢 OFF                                │
│  有効フラグ: compatibilityMap                        │
│  BAN 件数: 2                                         │
│  プロンプト最終更新: 2 日前                          │
├─────────────────────────────────────────────────────┤
│ ナビゲーション                                       │
│  [フラグ] [メンテ] [プロンプト] [BAN]                │
│  [履歴] [デプロイ↗] [Pages↗] [Analytics↗]           │
├─────────────────────────────────────────────────────┤
│ 直近の変更                                           │
│  2 日前  prompts/spiritChat 更新  [差分]            │
│  5 日前  flags 更新               [差分]             │
│  1 週前  maintenance OFF          [差分]             │
└─────────────────────────────────────────────────────┘
```

## MVP / post-MVP の境界

| 機能 | MVP | post-MVP |
|---|---|---|
| (a) フラグ編集 | ✓ | セグメント別配信、A/B 実験統合 |
| (b) メンテナンス | ✓ | 部分メンテ |
| (c) プロンプト編集 | ✓ | 下書き/公開フロー、承認者必須 |
| (d) BAN | ✓ | 理由カテゴリ、期限付き BAN |
| (e) 発見ディレクトリ | ✓ (手動追加) | jetstream で半自動化、申請ワークフロー |
| (f) 履歴 | ✓ | 高度なフィルタ、JSON diff の UI |
| (g) デプロイ導線 | ✓ (リンクのみ) | 埋め込み表示 (post-MVP で Pages Functions を使うなら再検討) |
| (h) ロールバック導線 | ✓ (リンクのみ) | 同上 |
| (i) メトリクス | ✓ (外部リンク) | 埋め込み iframe、カスタム指標 |

## 既存章への影響 (別作業で追記が必要)

- **02-architecture.md**: サーバー層の全削除。Cloudflare Worker を描かない。§パターン N (公開コンフィグ読み取り) を追加し、クライアント → 主管理者 PDS → コンフィグ 4 種を読むフローを明記
- **06-spirit.md**: システムプロンプトの保存場所が「リポジトリ直書き」から「主管理者 PDS (管理画面経由で編集可)」に変わる旨を §BYOK 対話 セクションに注記。`DEFAULT_SPIRIT_PROMPT` フォールバックはコードに残す
- **08-data-schema.md**: `app.aozoraquest.config.*` の 4 レキシコン定義を追加
- **09-tech-stack.md**: `apps/edge/` 削除、`wrangler.toml` 削除、Edge 関数を技術スタック表から除外。CSP に `plc.directory` を追加
- **10-roadmap.md**: Worker 関連タスクを除去。PDS レキシコンの新設と管理画面をフェーズに配置

## 非ゴール

- **ユーザー個別の PDS への介入**: `01-overview.md §データ所有権` に反するため行わない
- **コンテンツモデレーションの API 化**: BAN は静的な DID リストのみ
- **ユーザー行動の個別トラッキング**: 独自集計は行わない。メトリクスは Cloudflare Web Analytics のみ
- **RBAC (ロール階層)**: 主管理者 / 副管理者の二値。複雑な権限階層は不要
- **チーム招待機能**: 副管理者の追加は ADMIN_DIDS のビルド時定数に追加して再デプロイする

## 初期実装の最小ステップ

1. `app.aozoraquest.config.*` の 4 レキシコン JSON を `packages/lexicons/` に追加し、`@atproto/lex-cli` で型生成
2. `apps/admin` を最小雛形で立ち上げ、Bluesky OAuth ログインまで動かす
3. (a) フラグ編集と (b) メンテナンス制御の UI。`putRecord` で書き、`getRecord` で読むだけのシンプルな CRUD
4. `apps/web` (本体 SPA) にコンフィグ読み取り層を追加。boot 時に主管理者 DID の PDS から 4 コンフィグを取得、失敗時はデフォルト
5. (c) プロンプト編集、(d) BAN、(e) 履歴表示
6. (f)(g)(h) は外部リンクだけ置いて完了
