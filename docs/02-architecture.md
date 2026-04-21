# 02 - アーキテクチャ

## 全体像

```
┌────────────────────────────────────────────────────┐
│  Client (SPA, static hosting)                       │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  UI + State │  │  Browser    │  │  Quest     │ │
│  │  React      │  │  LLM        │  │  Engine    │ │
│  │             │  │  WebGPU     │  │  純粋関数  │ │
│  └─────────────┘  └─────────────┘  └────────────┘ │
│         │                │                 │        │
│  ┌──────┴────────────────┴─────────────────┴──┐   │
│  │  IndexedDB: モデル + キャッシュ + 設定      │   │
│  └─────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
         │          │              │              │
         │          │              │              │
         ▼          ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌──────────┐ ┌─────────────┐
│ ユーザーの  │ │ 主管理者の  │ │ Bluesky  │ │ Claude API  │
│ PDS         │ │ PDS         │ │ AppView  │ │ (BYOK のみ) │
│ データの    │ │ 公開コンフィグ│ │ TL 取得  │ │ Browser    │
│ 正本        │ │ (14-admin)  │ │          │ │ から直接    │
└─────────────┘ └─────────────┘ └──────────┘ └─────────────┘
```

サーバー層は存在しない。Aozora Quest の開発者が運用するホストは **Cloudflare Pages (静的配信) のみ**。Worker や独自 API は用意しない。

- ユーザーデータはユーザーの PDS に保存
- 運用コンフィグ (フラグ、プロンプト、メンテ、BAN) は主管理者 DID の PDS に保存し、全クライアント が boot 時に読み取る (14-admin.md)
- Claude API はユーザー自身の API キー (BYOK) でブラウザから直接叩く

## レイヤー詳細

### Client (SPA)

Vite + React で静的ビルドされる SPA。Cloudflare Pages でホスティングし、`aozoraquest.app` 配下に配置する。Service Worker は導入せず、キャッシュは CDN (Cloudflare Pages) と IndexedDB (Transformers.js の標準キャッシュ) に委ねる。オンライン前提で動作し、ネットワーク障害時はエラー表示とする。

**責務**:
- UI 描画とユーザー操作のハンドリング
- AT Protocol OAuth フローの実行 (`@atproto/oauth-client-browser`)
- AT Protocol API 呼び出し (PDS と AppView)
- タイムラインの取得と表示
- 投稿の作成と送信
- 投稿内容のトーン分類 (Browser LLM)
- 気質診断の実行 (Browser LLM + プロトタイプ埋め込み)
- クエスト生成と進捗判定
- ステータス計算と表示
- 相性計算
- 精霊セリフの生成 (テンプレート展開)

**使わないもの**:
- サーバーサイドレンダリング (完全静的)
- Cookie ベースの認証 (ATP OAuth の access token のみ)
- localStorage (センシティブデータは IndexedDB へ)

### Browser LLM

Hugging Face Transformers.js v4 を使って WebGPU 上で埋め込みモデルを動かす。採用モデルは `sirasagi62/ruri-v3-30m-ONNX` (int8 量子化、約 37MB、256 次元、日本語ネイティブ)。ModernBERT-ja を基盤にした Ruri-v3 の finetune 版で、JMTEB STS 82.48 と同サイズ帯で SOTA クラス。11-validation.md §実験 1 の結果で確定 (詳細: `docs/data/llm-benchmark.md`)。コードはモデル ID を `packages/core/src/embedding-config.ts` に集約している。

Web Worker 経由で UI スレッドと分離する。初回起動時にモデルをダウンロードして IndexedDB にキャッシュ (Transformers.js の標準機能)、以降は即座に利用可能。

**用途**:
- タイムラインバッジ判定: 投稿のトーン分類 (1 投稿 10-50ms)
- 気質診断: 8 認知機能それぞれのプロトタイプとの類似度計算
- クエスト達成判定: 投稿内容がクエスト条件に合致するかの判定

WebGPU 非対応環境 (一部モバイルブラウザ) では WebAssembly にフォールバック。自動切り替え。

### Quest Engine

純粋 TypeScript 関数の集合。LLM 依存なし。

**機能**:
- 毎朝のクエスト自動生成 (ステータスギャップに基づくテンプレート選択)
- ユーザー行動ごとの進捗更新
- 日付変更時の達成判定と XP 確定
- 節制クエストの「やらない」判定

### IndexedDB

ブラウザ内の永続ストレージ。以下を格納する。

| キー | 内容 | TTL |
|---|---|---|
| `model/e5-small` | 埋め込みモデルのバイナリ | 無期限 |
| `prototypes/*` | 事前埋め込みされたプロトタイプベクトル | 無期限 |
| `post-tags/<rkey>` | 投稿タグキャッシュ | 24h |
| `stats/raw` | 生のステータス値 (減衰計算用) | 無期限 |
| `quests/today` | 今日のクエスト | 日付変更でリセット |
| `settings` | ユーザー設定 (表示名バリアント、BYOK キー等) | 無期限 |

## External 層

### ユーザーの PDS

AT Protocol のデフォルト PDS (Bluesky 社が運営) または self-hosted PDS。

ユーザーが OAuth で認証した PDS に対して、カスタムレコードを `com.atproto.repo.putRecord` で書き込む。レキシコンは `app.aozoraquest.*` 名前空間で定義する。

データの正本は PDS 側。Client はキャッシュとして IndexedDB を持つが、衝突時は PDS 側を優先する。

### 主管理者の PDS (公開コンフィグ)

運用コンフィグ (フィーチャーフラグ、システムプロンプト、メンテナンスモード、BAN リスト) は主管理者 DID の PDS に `app.aozoraquest.config.*` レコードとして保存される。

- 書き込みは管理画面 (14-admin.md) から主管理者 DID の OAuth セッションで実行
- 読み取りは全クライアント が boot 時に `com.atproto.repo.getRecord` で直接取得
- クライアントは主管理者 DID をビルド時定数 `VITE_ADMIN_DIDS` の先頭から取得し、PLC ディレクトリ (`plc.directory`) で PDS エンドポイントに解決してから呼ぶ
- 取得失敗時は各コンフィグのデフォルト値で起動

### Bluesky AppView

`https://api.bsky.app` のエンドポイント群。CORS が許可されており、ブラウザから直接叩ける。

主な利用:
- `app.bsky.feed.getTimeline`: タイムライン取得
- `app.bsky.feed.getAuthorFeed`: 任意ユーザーの投稿取得 (診断、相性判定用)
- `app.bsky.actor.getProfile`: プロフィール情報取得
- `app.bsky.feed.getPostThread`: スレッド取得

### 外部 LLM API

BYOK (Bring Your Own Key) でのみアクセスされる。開発者が API キーを保持することはなく、中継 Worker も用意しない。ユーザーは以下のいずれかを選んで API キーを設定する。

| プロバイダー | 呼び出し先 | 備考 |
|---|---|---|
| Anthropic | `https://api.anthropic.com/v1/messages` | `anthropic-dangerous-direct-browser-access: true` 必須 |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | OpenAI 互換。多数のモデル選択可 |

設定画面でユーザーがプロバイダーを選び API キーを入力する。キーは IndexedDB に AES-GCM で暗号化保存する (09-tech-stack.md §セキュリティ)。課金とレート制限はユーザーと各プロバイダーの契約の中で完結する。

## データフロー

### パターン 1: タイムライン閲覧

```
User opens app
  ↓
Client → AppView: getTimeline()
  ↓
Client renders posts (no blocking)
  ↓
Browser LLM → tags each post (background)
  ↓
Badge resolver → display relevant badges
```

ネットワーク経由は AppView のみ。Claude API を呼ばない。

### パターン 2: 気質診断 (無料)

```
User requests diagnosis
  ↓
Client → AppView: getAuthorFeed(self, 150 posts)
  ↓
Browser LLM → embed all 150 posts
  ↓
Cosine similarity with 8 cognitive function prototypes
  ↓
Compose stats (ATK/DEF/AGI/INT/LUK)
  ↓
Determine job from top-2 cognitive functions
  ↓
Client → PDS: putRecord(app.aozoraquest.analysis)
```

外部呼び出しは AppView と PDS のみ。

### パターン 3: 精霊との会話 (BYOK)

```
User sends message to spirit
  ↓
Client → 選択したプロバイダーの LLM API
         (Anthropic or OpenRouter、ユーザーの API キーで直接)
  ↓
LLM API stream response
  ↓
Client renders streamed text
  ↓
On complete: Client → PDS: putRecord(app.aozoraquest.companion)
```

### パターン 4: 相性判定

```
User views another user's profile
  ↓
Client → AppView: getProfile(did)
  ↓
Attempt: Client → other PDS: getRecord(app.aozoraquest.analysis)
  ↓ (if not found or stale)
Fallback: Client → AppView: getAuthorFeed(did)
  ↓
Browser LLM → analyze their posts
  ↓
Pearson correlation + complementarity score
  ↓
Display compatibility
```

### パターン 5: 共鳴タイムライン (目玉機能)

```
App boot
  ↓
Client → admin PDS: getRecord(app.aozoraquest.directory) → N discoverable DIDs
  ↓
Client → each user's PDS: getRecord(app.aozoraquest.analysis) (in parallel, cache 7d)
  ↓
Compute resonance score for each (resonance = 0.6·sim + 0.4·comp)
  ↓
Take top K users (default K=30)
  ↓
Client → AppView: getAuthorFeed(did) × K (in parallel)
  ↓
Merge posts, rank by (resonance × freshness decay)
  ↓
Render as the "共鳴" timeline tab
```

ネットワーク呼び出しは AppView と各ユーザーの PDS のみ。Claude / 開発者サーバーは使わない。詳細は 05-compatibility.md §共鳴タイムライン。

## 技術的制約と選択

### WebGPU カバレッジ

2026 年 4 月時点で主要ブラウザすべてでデフォルト有効、世界カバレッジ約 82.7%。モバイルは一部環境で未対応。

**フォールバック戦略**:
1. `device: 'webgpu'` を試行
2. 失敗したら `device: 'wasm'` (CPU 実行、遅いが動く)
3. それも失敗したら診断機能を無効化し、BYOK で Claude API 使用を促す

### 初回モデルダウンロード

130MB のモデルを初回にダウンロードする必要がある。

**対策**:
- プログレスバー表示 (精霊の世界観で演出: 「精霊の知恵を召喚中...」)
- Cloudflare の CDN キャッシュで配信高速化
- Transformers.js の IndexedDB キャッシュで 2 回目以降は即座にロード

### PDS への書き込み頻度

ユーザー行動ごとに PDS へ書くとレート制限に引っかかる可能性がある。

**対策**:
- ステータスと進捗は IndexedDB で即更新
- PDS への同期は 1 日 1 回程度、または日付変更時
- 重要なマイルストーン (転職、称号獲得) のみ即時同期

### データの衝突解決

複数デバイスから同じ PDS に書き込む可能性がある。

**戦略**:
- Last-write-wins (LWW) ベース
- レコードに `updatedAt` (ISO 8601) を必ず含める
- クライアント側で新旧を判断して マージまたは置換

## セキュリティと認証

### OAuth フロー

`@atproto/oauth-client-browser` を使用する。パブリッククライアント (秘密鍵なし、PKCE 使用)。

```
1. /client-metadata.json を静的配信
2. User clicks "Login with Bluesky"
3. Redirect to user's PDS OAuth page
4. User authorizes
5. Redirect back to /oauth/callback with code
6. Exchange code for access + refresh tokens (DPoP bound)
7. Store tokens in IndexedDB
```

アクセストークンは DPoP バインドされるため、トークンを盗まれても別デバイスでは使えない。

### LLM API キー (BYOK)

Anthropic / OpenRouter のいずれかの API キーを IndexedDB に AES-GCM で暗号化保存する (09-tech-stack.md §セキュリティ §API キーの扱い)。

**注意**:
- XSS 脆弱性が致命的になるため、入力サニタイズとコンテンツセキュリティポリシーを厳格化
- 第三者 JavaScript を読み込まない (分析ツールも原則不使用)
- キーの存在を UI 上で見せない (設定画面でマスク表示のみ)

### 管理操作の権限検証

管理画面 (14-admin.md) からの運用コンフィグ編集は、Bluesky OAuth ログイン + AT Protocol の「自分の PDS にしか書けない」制約で自然に保護される。独自の認可サーバーや API は不要。

クライアント側の ADMIN_DIDS 判定は UI ゲーティング (誰に管理画面を表示するか) のみで、実質的な権限ではない。

## ネイティブ化の差分

将来 React Native (Expo) でネイティブアプリを出す場合の差分。

| 層 | Web | Native |
|---|---|---|
| UI | React + Tailwind | React Native + NativeWind |
| Browser LLM | Transformers.js | ONNX Runtime Mobile |
| OAuth | @atproto/oauth-client-browser | Custom + ASWebAuthenticationSession |
| ストレージ | IndexedDB | MMKV or SQLite |
| ATP Client | @atproto/api (isomorphic) | @atproto/api (同じ) |
| PDS スキーマ | 変更なし | 変更なし |

Client 層だけ書き換えれば済むように、ビジネスロジック (`packages/core`) は Web / Native 共通にする。

## モノレポ構成

```
aozoraquest/
├── apps/
│   ├── web/                     Vite + React (本体 SPA)
│   └── admin/                   Vite + React (管理画面)
├── packages/
│   ├── core/                    ジョブ定義、ステータス計算、相性計算
│   ├── lexicons/                AT Protocol レキシコン JSON (ユーザーデータ + 管理コンフィグ)
│   ├── prompts/                 精霊セリフテンプレート、タグプロトタイプ
│   └── types/                   TypeScript 共通型定義
├── public/
│   └── prototypes/              事前埋め込みバイナリ (.bin)
├── docs/                        本ドキュメント
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

pnpm ワークスペース推奨。`packages/core` が最も共有される実装単位で、Web / 管理画面 / 将来の Native から参照される。サーバー層 (Worker) は存在しない。
