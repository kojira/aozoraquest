# 09 - 技術スタックと実装ガイドライン

## 全体スタック

| レイヤー | 技術 | 備考 |
|---|---|---|
| ホスティング (Web + 管理画面) | Cloudflare Pages | 静的配信、SSL、CDN。Worker / Functions は使わない |
| フロントエンドフレームワーク | Vite + React 18+ | SPA + 静的ビルド。`vite build` で配信用 `dist/` を出力 |
| ルーティング | React Router v7 (data mode) | 明示ルート定義。ファイルベースは採用しない |
| UI ライブラリ | React 18+ | |
| スタイリング | Tailwind CSS + shadcn/ui | |
| アイコン | Lucide React | SVG ベース |
| グラフ | Recharts または自前 SVG | レーダー、折れ線 |
| AT Protocol | `@atproto/api`, `@atproto/oauth-client-browser` | 公式 |
| LLM (ローカル) | `@huggingface/transformers` v4 | WebGPU、ブラウザ内埋め込み |
| 埋め込みモデル | `sirasagi62/ruri-v3-30m-ONNX` (int8, ~37MB, 256次元、日本語ネイティブ) | 11-validation.md §実験 1 で確定 (docs/data/llm-benchmark.md)。Ruri v3 = ModernBERT-ja 基盤、JMTEB STS 82.48。差し替え時は `packages/core/src/embedding-config.ts` と プロトタイプ事前埋め込みを同時に更新 |
| LLM (BYOK) | Anthropic / OpenRouter | ユーザーが選択した API キーでブラウザから直接呼び出す。Anthropic は `@anthropic-ai/sdk`、OpenRouter は OpenAI 互換なので `openai` SDK |
| クライアントストレージ | IndexedDB (via `idb` または `dexie`) | |
| 型検証 | Zod | |
| ビルドシステム | pnpm + Turbo | モノレポ |
| テスト | Vitest + Playwright | |
| リンター | Biome または ESLint + Prettier | |

## モノレポ構成

```
aozoraquest/
├── apps/
│   ├── web/                    Vite + React アプリ (本体 SPA)
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx        エントリーポイント
│   │   │   ├── routes/         画面コンポーネント (React Router に登録)
│   │   │   ├── components/
│   │   │   └── lib/
│   │   ├── public/             静的アセット
│   │   │   ├── client-metadata.json
│   │   │   └── prototypes/     事前埋め込みバイナリ
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── admin/                  Vite + React アプリ (管理画面)
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx
│       │   ├── routes/
│       │   └── components/
│       ├── public/
│       │   └── client-metadata.json
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   ├── core/                   共有ビジネスロジック
│   │   ├── src/
│   │   │   ├── jobs.ts         16 ジョブ定義
│   │   │   ├── stats.ts        ステータス計算、形マッチング
│   │   │   ├── compat.ts       共鳴度計算
│   │   │   ├── quest.ts        クエスト生成と判定
│   │   │   ├── diagnosis.ts    気質診断
│   │   │   ├── spirit.ts       精霊セリフテンプレート展開
│   │   │   └── weights.ts      行動重み表
│   │   └── package.json
│   ├── lexicons/               AT Protocol レキシコン JSON
│   │   ├── profile.json
│   │   ├── analysis.json
│   │   ├── questLog.json
│   │   ├── companion.json
│   │   └── companionLog.json
│   ├── prompts/                プロトタイプとテンプレート
│   │   ├── cognitive/          8 機能のプロトタイプ
│   │   │   ├── Ni.json (25件)
│   │   │   ├── Ne.json (25件)
│   │   │   └── ...
│   │   ├── tags/               9 種のタグプロトタイプ
│   │   └── spirit-lines.ts     精霊セリフ
│   └── types/                  共有型定義
│       └── src/index.ts
├── scripts/
│   ├── build-prototypes.ts     プロトタイプ埋め込みバイナリ生成
│   └── verify-lexicons.ts      スキーマ検証
├── docs/                       本ドキュメント
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

## 主要パッケージの設計方針

### packages/core

純粋関数のみ。ブラウザ API も Node.js API も依存しない (isomorphic)。これにより:
- 本体 SPA と管理画面と将来の Native で共有可能
- テストが書きやすい

```typescript
// packages/core/src/index.ts
export * from './jobs';
export * from './stats';
export * from './compat';
export * from './quest';
export * from './diagnosis';
export * from './spirit';
export * from './weights';
```

### packages/lexicons

AT Protocol のレキシコン JSON をそのまま配置。ビルド時に `@atproto/lex-cli` で TypeScript 型を生成。

```bash
npx @atproto/lex-cli gen-api packages/types/src/lexicons packages/lexicons/*.json
```

### packages/prompts

プロトタイプとセリフテンプレートの定義。実行時にロードされる。

## Vite + React の設定

### vite.config.ts (apps/web)

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 9999, strictPort: true },
  preview: { port: 9999 },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
});
```

管理画面 (`apps/admin/vite.config.ts`) はポート `9998` を使う以外は同じ。Service Worker は導入しない (モデルキャッシュは Transformers.js が IndexedDB に自動保存する)。

### ルーティング (React Router v7 data mode)

```typescript
// apps/web/src/main.tsx
import { createBrowserRouter, RouterProvider } from 'react-router';
import { createRoot } from 'react-dom/client';

const router = createBrowserRouter([
  { path: '/',                element: <Home />,          loader: requireAuth },
  { path: '/profile/:handle', element: <Profile /> },
  { path: '/me',              element: <MyProfile />,     loader: requireAuth },
  { path: '/compose',         element: <Compose />,       loader: requireAuth },
  { path: '/post/:uri',       element: <PostDetail /> },
  { path: '/notifications',   element: <Notifications />, loader: requireAuth },
  { path: '/search',          element: <Search /> },
  { path: '/settings',        element: <Settings />,      loader: requireAuth },
  { path: '/onboarding',      element: <Onboarding /> },
  { path: '/oauth/callback',  element: <OAuthCallback /> },
  { path: '/tos',             element: <Tos /> },
  { path: '/privacy',         element: <Privacy /> },
]);

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
```

| パス | 画面 | 備考 |
|---|---|---|
| `/` | Home (タイムライン、フォロー/共鳴タブ) | 認証必須 |
| `/profile/:handle` | プロフィール (他人含む) | |
| `/me` | 自分のプロフィール | |
| `/compose` | 投稿作成 | |
| `/post/:uri` | 投稿詳細 (URI エンコード済み) | |
| `/notifications` | 通知 | |
| `/search` | 検索 | |
| `/settings` | 設定 | |
| `/onboarding` | オンボーディング | 初回のみ |
| `/oauth/callback` | OAuth コールバック | |
| `/client-metadata.json` | OAuth クライアントメタ (public 配下に静的ファイルで配置) | |
| `/tos`, `/privacy` | 規約 | |

### SPA フォールバック

React Router は History API ベース (`createBrowserRouter`)。Cloudflare Pages の SPA モードを有効化するか、`public/_redirects` に以下を置いて全ルートを `index.html` に戻す:

```
/*    /index.html   200
```

### OAuth コールバック処理

```typescript
// apps/web/src/routes/oauth-callback.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { getOAuthClient } from '@/lib/oauth';

export default function OAuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    getOAuthClient().init()
      .then(() => navigate('/', { replace: true }))
      .catch(err => {
        console.error('OAuth error', err);
        navigate('/?error=oauth', { replace: true });
      });
  }, [navigate]);

  return <p>認証中...</p>;
}
```

## Transformers.js の使い方

### モデル ID の外部化

**採用する埋め込みモデルは 11-validation.md §実験 1 で確定する**。コード上はモデル ID を定数として一箇所に集約し、差し替えやすくしておく。

```typescript
// packages/core/src/embedding-config.ts
export const EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small'; // 暫定。実験 1 で決定
export const EMBEDDING_DIMENSIONS = 384;                           // モデルと合わせる
export const EMBEDDING_DTYPE = 'q8' as const;
```

プロトタイプの事前埋め込み (`packages/prompts/cognitive/*.bin` と `packages/prompts/tags/*.bin`) は選定モデルで再生成する。次元数が変わったらプロトタイプも再生成が必須 (ビルドスクリプトでモデル ID ハッシュをアセット名に入れてキャッシュ不整合を防ぐ)。

### 初期化

```typescript
import { pipeline, env } from '@huggingface/transformers';
import { EMBEDDING_MODEL_ID, EMBEDDING_DTYPE } from '@aozoraquest/core/embedding-config';

env.useBrowserCache = true;
env.allowLocalModels = false;

let extractor: any = null;

export async function initLLM(onProgress?: (p: number) => void) {
  if (extractor) return extractor;

  extractor = await pipeline(
    'feature-extraction',
    EMBEDDING_MODEL_ID,
    {
      device: 'webgpu',
      dtype: EMBEDDING_DTYPE,
      progress_callback: onProgress,
    }
  );

  return extractor;
}
```

### Web Worker で動かす

UI スレッドを止めないため Worker で実行する。

```typescript
// apps/web/workers/llm.worker.ts
import { pipeline } from '@huggingface/transformers';

let extractor: any = null;

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data;
  
  switch (type) {
    case 'init': {
      extractor = await pipeline(
        'feature-extraction',
        EMBEDDING_MODEL_ID,
        { device: 'webgpu', dtype: EMBEDDING_DTYPE }
      );
      self.postMessage({ type: 'ready' });
      break;
    }
    case 'embed': {
      const vec = await extractor(payload.text, {
        pooling: 'mean',
        normalize: true,
      });
      self.postMessage({ type: 'result', id: payload.id, vec: vec.tolist()[0] });
      break;
    }
  }
});
```

メインスレッド側:

```typescript
const worker = new Worker(new URL('./workers/llm.worker.ts', import.meta.url), {
  type: 'module',
});

async function embed(text: string): Promise<number[]> {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    worker.addEventListener('message', function handler(e) {
      if (e.data.id === id) {
        worker.removeEventListener('message', handler);
        resolve(e.data.vec);
      }
    });
    worker.postMessage({ type: 'embed', payload: { id, text } });
  });
}
```

### WebGPU フォールバック

```typescript
async function createExtractor() {
  try {
    return await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { device: 'webgpu', dtype: EMBEDDING_DTYPE });
  } catch (gpuError) {
    console.warn('WebGPU failed, falling back to WASM', gpuError);
    return await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { device: 'wasm', dtype: EMBEDDING_DTYPE });
  }
}
```

WASM 版は 5-10 倍遅い。その場合は UI で「処理に時間がかかります」を表示。

## 外部 LLM 呼び出し (BYOK、プロバイダー抽象化)

外部 LLM を使う機能 (精霊自由対話、上位診断、投稿下書き生成) はすべて**ユーザー自身の API キーでブラウザから直接呼ぶ**。開発者は API キーを保持せず、中継 Worker も用意しない。ユーザーは Anthropic / OpenRouter のいずれかを選択できる。

### 対応プロバイダー

| プロバイダー | エンドポイント | 依存 | 特徴 |
|---|---|---|---|
| Anthropic | `https://api.anthropic.com/v1/messages` | `@anthropic-ai/sdk` | Claude ネイティブ |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `openai` (OpenAI SDK) | OpenAI 互換、多数のモデル |

### プロバイダー抽象

```typescript
// packages/core/src/llm.ts (簡略)
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type Provider = 'anthropic' | 'openrouter';
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface BYOKConfig {
  provider: Provider;
  apiKey: string;
  model: string;
}

export async function* streamChat(
  cfg: BYOKConfig,
  system: string,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  if (cfg.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
    const stream = client.messages.stream({
      model: cfg.model,
      max_tokens: 512,
      system,
      messages,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  } else {
    // OpenRouter は OpenAI 互換
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'HTTP-Referer': 'https://aozoraquest.app',
        'X-Title': 'Aozora Quest',
      },
    });
    const stream = await client.chat.completions.create({
      model: cfg.model,
      max_tokens: 512,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
```

`system` プロンプトはどちらのプロバイダーでも同じ文面を渡せるようにする (プロンプトエンジニアリング側でプロバイダー依存の書き分けを避ける)。プロンプトは管理者 PDS の `app.aozoraquest.config.prompts` (rkey=`spiritChat`) から boot 時に取得する (14-admin.md §(c))。

### モデル識別子の例

| プロバイダー | 識別子の形 | 例 |
|---|---|---|
| Anthropic | Anthropic 公式のモデル ID | `claude-haiku-4-5-20251001` |
| OpenRouter | `<provider>/<model>` | `anthropic/claude-haiku-4.5`、`openai/gpt-5`、`google/gemini-2.5-flash` |

UI 上ではプロバイダー選択 → モデル選択の 2 段構成にする (07-ui-design.md §AI 接続)。

## 公開コンフィグの取得

主管理者 DID の PDS から 4 種のコンフィグを boot 時に読む。

```typescript
// apps/web/lib/config.ts (簡略)
import { AtpAgent } from '@atproto/api';

const MAIN_ADMIN_DID = import.meta.env.VITE_ADMIN_DIDS!.split(',')[0];

export async function loadRuntimeConfig() {
  const pdsUrl = await resolveDidToPds(MAIN_ADMIN_DID); // PLC directory
  const agent = new AtpAgent({ service: pdsUrl });

  const [flags, maintenance, bans, spiritPrompt] = await Promise.allSettled([
    agent.com.atproto.repo.getRecord({
      repo: MAIN_ADMIN_DID,
      collection: 'app.aozoraquest.config.flags',
      rkey: 'self',
    }),
    agent.com.atproto.repo.getRecord({
      repo: MAIN_ADMIN_DID,
      collection: 'app.aozoraquest.config.maintenance',
      rkey: 'self',
    }),
    agent.com.atproto.repo.getRecord({
      repo: MAIN_ADMIN_DID,
      collection: 'app.aozoraquest.config.bans',
      rkey: 'self',
    }),
    agent.com.atproto.repo.getRecord({
      repo: MAIN_ADMIN_DID,
      collection: 'app.aozoraquest.config.prompts',
      rkey: 'spiritChat',
    }),
  ]);

  return {
    flags: flags.status === 'fulfilled' ? flags.value.data.value : DEFAULT_FLAGS,
    maintenance: maintenance.status === 'fulfilled' ? maintenance.value.data.value : { enabled: false },
    bans: bans.status === 'fulfilled' ? bans.value.data.value.dids : [],
    spiritPrompt: spiritPrompt.status === 'fulfilled' ? spiritPrompt.value.data.value.body : DEFAULT_SPIRIT_PROMPT,
  };
}
```

取得失敗時は各項目のデフォルト値で起動する。ランタイム中のポーリングは行わない (次回起動まで反映されない)。

## ビルド & デプロイ

### プロジェクトルートのスクリプト

ルート `package.json`:

```json
{
  "name": "aozoraquest",
  "private": true,
  "packageManager": "pnpm@9",
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "build:prototypes": "pnpm --filter @aozoraquest/prompts build-prototypes",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "lint": {},
    "test": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

### 開発

```bash
pnpm install
pnpm build:prototypes  # 初回のみ: 埋め込みバイナリ生成
pnpm dev               # 本体 SPA (9999) + 管理画面 (9998) を並列起動
```

`pnpm dev` は `turbo run dev --parallel` を叩き、`apps/web` と `apps/admin` の両方の Vite dev server を同時に立ち上げる。Ctrl-C で両方停止。

個別起動したい場合は:

```bash
pnpm --filter @aozoraquest/web dev     # 本体のみ
pnpm --filter @aozoraquest/admin dev   # 管理画面のみ
```

### プロトタイプの事前埋め込み

開発時または CI で 1 回だけ実行。

```bash
pnpm build:prototypes
# packages/prompts/cognitive/*.json を読み込み
# Transformers.js でベクトル化
# apps/web/public/prototypes/*.bin として出力
```

### 本番ビルド

```bash
pnpm build   # apps/web/dist と apps/admin/dist に出力
```

またはアプリ個別:

```bash
pnpm --filter @aozoraquest/web build
pnpm --filter @aozoraquest/admin build
```

### Cloudflare Pages デプロイ

GitHub 連携で自動デプロイ。本体 SPA と管理画面は**別プロジェクト**として登録する (サブドメインと XSS 分離のため、14-admin.md §サブドメインとホスティング)。

本体 SPA (`aozoraquest.app`):
```
Root directory:          apps/web
Build command:           pnpm --filter @aozoraquest/web... build
Build output directory:  apps/web/dist
Environment variables:
  VITE_APP_URL=https://aozoraquest.app
  VITE_ADMIN_DIDS=did:plc:xxx,did:plc:yyy
```

管理画面 (`admin.aozoraquest.app`):
```
Root directory:          apps/admin
Build command:           pnpm --filter @aozoraquest/admin... build
Build output directory:  apps/admin/dist
Environment variables:
  VITE_APP_URL=https://admin.aozoraquest.app
  VITE_ADMIN_DIDS=did:plc:xxx,did:plc:yyy
```

Vite は環境変数を `VITE_` プレフィックスで読み込む (コードからは `import.meta.env.VITE_ADMIN_DIDS` でアクセス)。

## テスト戦略

### ユニットテスト (Vitest)

`packages/core` の純粋関数はすべてテスト。

```typescript
// packages/core/src/__tests__/compat.test.ts
import { describe, it, expect } from 'vitest';
import { similarity, resonance } from '../compat';

describe('similarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [20, 30, 10, 25, 15];
    expect(similarity(v, v)).toBeCloseTo(1.0);
  });
  
  it('returns 0 for flat vector', () => {
    const flat = [20, 20, 20, 20, 20];
    const peaked = [40, 10, 10, 30, 10];
    expect(similarity(flat, peaked)).toBeCloseTo(0);
  });
});
```

### 統合テスト

クエスト生成、達成判定、ステータス更新の一連のフローを実装例でテスト。

### E2E テスト (Playwright)

主要ユーザーフロー:
- オンボーディング完了
- 投稿作成
- クエスト達成
- プロフィール表示
- 設定変更

WebGPU はヘッドレスブラウザで動作しないため、WASM フォールバック経路でテスト。

## パフォーマンス目標

| 項目 | 目標 |
|---|---|
| 初回ロード (モデル含む) | 60 秒以内 (3G) |
| 2 回目起動 | 2 秒以内 (キャッシュ) |
| タイムライン初回表示 | 1.5 秒以内 |
| 投稿タグ付け | 50ms 以内 / 投稿 |
| 気質診断 (150 投稿) | 10 秒以内 |
| 共鳴度計算 | 100ms 以内 (キャッシュあり) |

## アクセシビリティ

- Lighthouse Accessibility スコア 95 以上
- Keyboard ナビゲーション全画面対応
- スクリーンリーダー (VoiceOver, NVDA) で主要操作可能
- `prefers-reduced-motion` 対応

## セキュリティ

### CSP

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
connect-src 'self' https://*.bsky.app https://*.bsky.network
            https://bsky.social https://plc.directory
            https://api.anthropic.com https://openrouter.ai
            https://huggingface.co https://cdn.jsdelivr.net;
img-src 'self' https://cdn.bsky.app https://*.bsky.social data: blob:;
worker-src 'self' blob:;
```

`wasm-unsafe-eval` は Transformers.js の WASM 実行に必要。`plc.directory` は主管理者 DID → PDS エンドポイントの解決に使う。`openrouter.ai` は BYOK 経由の LLM 呼び出し先。

### API キーの扱い (BYOK)

- IndexedDB に保存
- Web Crypto API で AES-GCM 暗号化 (Origin-bound key)
- メモリ内では使用時だけ展開
- UI にはマスク表示のみ

## 多言語対応

MVP は日本語のみ。将来の i18n 対応のため:

- UI テキストは `en.json`, `ja.json` で管理 (MVP 時点では ja のみ)
- `next-intl` または `react-i18next` を導入
- 日付・時刻のフォーマットは `Intl.DateTimeFormat`

## 分析・モニタリング

- **プロダクト分析**: プライバシー重視のため標準的な Google Analytics を使わない。Cloudflare Web Analytics (クライアントサイドスクリプト不要) を使用
- **エラー監視**: Sentry (または Cloudflare が提供する同等品)、ただし投稿内容や PII を送らないよう厳格化
- **パフォーマンス**: Real User Monitoring は Cloudflare に任せる

## 開発環境の推奨

- Node.js 22+
- pnpm 9+
- Chrome Canary (WebGPU のデバッグが最良)
- Firefox (WebGPU 互換性確認)
- VS Code + Biome / ESLint / Tailwind IntelliSense
