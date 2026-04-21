# 12 - テスト戦略

## 目的

Aozora Quest は**バックエンドレス・純粋関数の多いクライアントサイド SPA**。サーバー側テストはゼロ、ブラウザ内計算が正しいことを担保するのが主目的。

## テストピラミッド (本プロジェクト版)

```
         ┌─────────────┐
         │  E2E (少数)  │  Playwright + 本番ビルド
         ├─────────────┤
         │  Integration│  Vitest + jsdom、AT Proto モック
         ├─────────────┤
         │             │
         │    Unit     │  Vitest、純粋関数中心
         │             │
         └─────────────┘
```

**Unit が最大比率**。`packages/core` の純粋関数 (ステータス計算、ジョブマッチ、共鳴度、クエスト生成、減衰、診断の cosine similarity) はすべてユニットテストで固める。

## Unit テスト (Vitest)

### 対象

| パッケージ | 主要関数 | テスト粒度 |
|---|---|---|
| `packages/core/jobs` | `matchJob`、`wandererScore` | 既知入力 → 既知出力 |
| `packages/core/stats` | `applyAction`、`decay`、`normalize` | 境界値 (減衰ゼロ、上限、下限) |
| `packages/core/compat` | `similarity`、`complementarity`、`resonance` | 統計的性質 (対称性、同一ベクトルで 1.0) |
| `packages/core/quest` | `generateDailyQuests`、`matchQuest` | シードベース決定性 |
| `packages/core/diagnosis` | `cognitiveToRpg`、`classify` | 係数マトリクスの行和 = 1 |
| `packages/core/embedding` | `cosineSimilarity`、`classify` (閾値含む) | ゴールデンベクトル固定で期待値一致 |

### フィクスチャ

- `packages/core/__fixtures__/known-users.json`: 既知の自認タイプ付きユーザー (診断回帰テスト用)
- `packages/core/__fixtures__/stat-histories.json`: 30 日分のアクション履歴 (減衰/集計回帰テスト用)
- `packages/core/__fixtures__/embeddings.bin`: 少数の固定ベクトル (cosine similarity の数値一致確認用)

### 診断アルゴリズムの回帰テスト

モデル差し替え時に精度が劣化しないことを CI で自動検知する。

```typescript
// packages/core/__tests__/diagnosis.regression.test.ts
import knownUsers from '../__fixtures__/known-users.json';

test.each(knownUsers)('user $handle expected archetype $expectedArchetype', async ({ posts, expectedArchetype }) => {
  const result = await diagnose(posts);
  // Top-3 に正解が含まれていれば合格
  expect(result.topK.slice(0, 3)).toContain(expectedArchetype);
});
```

### レキシコン回帰テスト

```typescript
// packages/lexicons/__tests__/schema.test.ts
test('profile record passes Zod refinement', () => {
  const data = { targetJob: 'sage', nameVariant: 'default', updatedAt: new Date().toISOString() };
  expect(ProfileSchema.safeParse(data).success).toBe(true);
});

test('analysis.rpgStats sums to 100 ± 1', () => {
  const stats = { atk: 25, def: 20, agi: 20, int: 25, luk: 10 };
  expect(Math.abs(Object.values(stats).reduce((a, b) => a + b) - 100)).toBeLessThanOrEqual(1);
});
```

### カバレッジ目標

| パッケージ | 目標 |
|---|---|
| `packages/core` | Line ≥ 85%、Branch ≥ 75% |
| `packages/lexicons` | 100% (スキーマのみ) |
| `apps/web` (UI) | 主要 UI フローのみ (smoke) |

## Integration テスト

### AT Protocol モック

外部依存 (AT Proto PDS、AppView) は `@atproto/api` のクライアントをモックして駆動する。`msw` (Mock Service Worker) でネットワーク層を一括モック。

```typescript
// apps/web/src/__tests__/oauth-flow.test.ts
const server = setupServer(
  http.get('https://bsky.social/xrpc/com.atproto.server.describeServer', () =>
    HttpResponse.json({ did: 'did:plc:mock' }),
  ),
  http.post('https://bsky.social/xrpc/com.atproto.server.createSession', () =>
    HttpResponse.json({ accessJwt: 'mock.jwt', refreshJwt: 'mock.refresh', did: 'did:plc:mock', handle: 'test.bsky.social' }),
  ),
);
```

### 統合対象

- OAuth フロー (`@atproto/oauth-client-browser` のモック)
- PDS レコード読み書きの往復 (putRecord → getRecord)
- 公開コンフィグの取得 (主管理者 PDS mock から flags / prompts)
- 共鳴タイムラインの構築 (ディレクトリ → 複数ユーザー取得 → ランキング)

## E2E テスト (Playwright)

**最小限のみ**。UI の実ブラウザ動作を確認する。

### テストシナリオ

| シナリオ | 目的 |
|---|---|
| ログイン → オンボーディング完了 | OAuth フロー + 初回診断が通る |
| 投稿 → クエスト進捗 | アクションがステータスに反映される |
| 共鳴 TL 表示 | 管理者 PDS のディレクトリ経由で他ユーザー投稿が見える |
| BYOK 設定 → 精霊自由対話 | BYOK フローと Claude ストリーミング |
| 管理画面 (admin.aozoraquest.app) | 管理者 DID でログイン → KV 編集 |

### WebGPU の注意

Playwright の Chromium は WebGPU 対応だがヘッドレスモードでは機能しないことがある。LLM 推論を含む E2E は:

- `headless: false` で走らせる (CI でも xvfb で仮想ディスプレイを用意)
- または WASM フォールバックで走らせ、LLM 依存シナリオだけカバレッジから外す

### AT Proto サンドボックス

β ローンチ前の E2E は Bluesky の公式 PDS を叩かず、ローカル PDS (Docker) を立てる:

```
docker run -p 2583:2583 ghcr.io/bluesky-social/pds:latest
```

テスト用の DID とレコードをプリロードしたスナップショットを用意して、再現性を確保。

## ビジュアルリグレッション

- Storybook + Chromatic (または Percy) で主要コンポーネントのビジュアル差分を自動検出
- ダークモード・ライトモードそれぞれで
- 優先対象: レーダーチャート、共鳴マップ、バッジ、精霊パネル

## アクセシビリティテスト

- Vitest + `@axe-core/react` で CI で aXe 自動検査
- Lighthouse CI でアクセシビリティスコア 95 以上を gate

## LLM 関連のテスト特殊事情

LLM 出力は非決定的 (temperature > 0 の場合) で、通常の snapshot テストが効かない。以下で対応:

| 対象 | 戦略 |
|---|---|
| 埋め込みベクトル (Ruri-v3) | 決定的。固定入力の期待ベクトルを `__fixtures__/embeddings.bin` に保存、bit-exact 比較 |
| 生成 (TinySwallow) | 非決定的。長さ・言語 (日本語混入率) ・禁止ワード不在などの**性質テスト** |
| BYOK 呼び出し | モック。Anthropic SDK / OpenAI SDK を stub する |

```typescript
test('spirit line is Japanese and under 100 chars', async () => {
  const out = await generateSpiritLine(...);
  expect(out.length).toBeLessThanOrEqual(100);
  expect(isJapaneseMajority(out)).toBe(true);
  expect(containsForbiddenWord(out)).toBe(false);
});
```

## テストスクリプト (Turbo)

`package.json` ルートの scripts:

```json
{
  "test": "turbo run test",
  "test:unit": "turbo run test -- --run",
  "test:e2e": "turbo run test:e2e",
  "test:watch": "turbo run test -- --watch",
  "typecheck": "turbo run typecheck"
}
```

各パッケージは `vitest.config.ts` を持ち、`apps/web` のみ `playwright.config.ts` を追加で持つ。

## CI での実行

13-ops.md §GitHub Actions 参照。

1. PR: unit + integration (並列、< 2 分目標)
2. main への push: + E2E (順次、~5 分)
3. リリース候補タグ: + ビジュアルリグレッション + Lighthouse

## 非ゴール

- **100% カバレッジ**: UI のエッジケースや CSS 変種は手動確認で十分
- **フルバックエンド E2E**: バックエンドが存在しないので不要
- **負荷テスト**: すべての計算がクライアント側なので、負荷はユーザー数と無関係
- **LLM の生成品質を CI で保証**: 11-validation.md で人手で行う
