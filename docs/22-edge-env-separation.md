# エッジ Worker の dev/本番 分離 (docs/22)

## 背景・原則

エッジ Worker (`aozoraquest-edge`) は #363 で **1 デプロイで dev/本番を捌く**構成にした。
環境の区別はリクエスト Origin → データ名前空間 (`dev.aozoraquest.app`→`app.aozoraquest.dev`) だけ。
これは **データは分離するがコードは共有**する構成で、エッジをデプロイすると dev/本番が同時に変わる。

**この構成は不可** (オーナー方針 2026-07-19):「dev が本番に影響のある構成を良しとするのはありえない」。
dev は本番に**一切**触れられないのが原則。Web アプリが `aozoraquest-dev` / `aozoraquest` の 2 デプロイに
分かれているのと同様、**エッジも dev 用と本番用の別 Worker に分ける**。

## 設計

- **本番エッジ**: `aozoraquest-edge` (top-level wrangler config)。`wrangler deploy` (main リリース時)。
- **dev エッジ**: `aozoraquest-edge-dev` (`[env.dev]`)。`wrangler deploy --env dev`。
  URL は worker 名から自動: `https://aozoraquest-edge-dev.kojiran.workers.dev`。
- **サーバーアカウントは同じでよい**。dev エッジは別 client_id (= dev の `/client-metadata.json` URL) で
  同じアカウントを認可するので、**独立した OAuth grant / 独立した refresh チェーン**になり本番と干渉しない。
  分けるのは「別 KV (別トークン保管) / 別 cron / 別 secrets」であって「別アカウント」ではない。
- **KV / cron / secrets はすべて dev 専用**。dev の cron は自分のセッションのトークンだけ refresh する。

## 進捗 (2026-07-20)

- ✅ step1 dev KV 作成 (`ef1a0429afc34c7da4ee5183752a5f3e`) → wrangler.toml 反映
- ✅ step2 dev secret set (OAUTH_CLIENT/DPOP_JWK・WORLD_TOKEN_SECRET・SERVER_DID・ADMIN_DIDS=kojira.io の DID)
- ✅ step3 `wrangler deploy --env dev` → `https://aozoraquest-edge-dev.kojiran.workers.dev` 稼働
      (`/api/world/reset` が 401 = ルート存在。共有エッジは 404 だった)
- ✅ step5 ローカル: `.env.development` に VITE_EDGE_URL/DID を dev エッジで追記
- ✅ **step5 (dev デプロイ)** CF 変数は**不要にした**: world-server.ts で `VITE_NSID_ENV=dev` の
      とき dev エッジを**コードで強制** (#396)。dev push で dev.aozoraquest.app が自動的に dev エッジへ。
- ⬜ **step4 OAuth bootstrap** dev エッジに向いた web (ローカル or dev.aozoraquest.app) で
      管理者ログイン → 設定 → 「サーバーアカウント OAuth 連携」ボタン → kojira.io を承認 →
      dev KV にトークン保存。**オーナー操作 (ブラウザ)**。

## セットアップ手順 (runbook)

前提: `wrangler whoami` が CF アカウント (account id は CF ダッシュボード参照) にログイン済み。
`cd apps/edge` で実行。secret 値はチャット/リポジトリに残さない (§4)。

### 1. dev 専用 KV を作る
```
wrangler kv namespace create OAUTH_TOKENS --env dev
wrangler kv namespace create OAUTH_TOKENS --env dev --preview
```
→ 出力の `id` / `preview_id` を `wrangler.toml` の `[[env.dev.kv_namespaces]]` の `REPLACE_WITH_DEV_KV_ID` に貼る。

### 2. dev 専用の鍵/secret を生成して set
本番と別の鍵にする (完全独立)。
- `OAUTH_CLIENT_PRIVATE_JWK`: 新規 P-256 鍵 (confidential client の client assertion 用)。
- `OAUTH_DPOP_PRIVATE_JWK`: 新規 P-256 鍵 (DPoP 用)。
- `WORLD_TOKEN_SECRET`: 新規ランダム (位置トークン署名用)。
```
wrangler secret put OAUTH_CLIENT_PRIVATE_JWK --env dev
wrangler secret put OAUTH_DPOP_PRIVATE_JWK --env dev
wrangler secret put WORLD_TOKEN_SECRET --env dev
# personal な値 (本番と同じでよい) も dev 用に set:
wrangler secret put SERVER_DID --env dev        # サーバーアカウントの DID (本番と同じ)
wrangler secret put ADMIN_DIDS --env dev         # 管理者 DID (本番と同じ)
wrangler secret put OAUTH_SCOPE --env dev         # 本番と同じ (例 "atproto transition:generic")
```
(`WORKER_DID` / `PUBLIC_ORIGIN` / `ALLOWED_ORIGINS` は wrangler.toml の `[env.dev.vars]` に記載済み = secret 不要。)

### 3. dev エッジをデプロイ
```
wrangler deploy --env dev
```
→ `https://aozoraquest-edge-dev.kojiran.workers.dev` が立つ。**本番エッジには一切触れない**。

### 4. dev エッジで OAuth を bootstrap (サーバーアカウントを認可)
管理者が dev エッジの OAuth 開始フローを踏み、dev KV にトークンを入れる (本番とは別セッション):
```
POST https://aozoraquest-edge-dev.kojiran.workers.dev/api/oauth/start   (ADMIN_DIDS の service auth JWT)
→ 返った authorizeUrl をブラウザで開いてサーバーアカウントで承認
→ /oauth/callback が dev KV にトークン保存
```

### 5. dev web を dev エッジに向ける
**重要**: 現状 `apps/web/.env.development` には `VITE_EDGE_*` 行が**無い** → Vite は
`.env` の値 (= 本番エッジ `aozoraquest-edge.kojiran.workers.dev`) を継承する。
**これが「dev web が共有/本番エッジを叩いていた」現状の原因**。dev エッジに向けるには
`.env.development` に以下 2 行を**追記**して `.env` の本番値を上書きする:
```
VITE_EDGE_URL=https://aozoraquest-edge-dev.kojiran.workers.dev
VITE_EDGE_DID=did:web:aozoraquest-edge-dev.kojiran.workers.dev
```
- **dev.aozoraquest.app デプロイ**: CF Variables は不要。world-server.ts が `VITE_NSID_ENV=dev`
  (dev ビルドに既に入っている) を見て dev エッジを強制する (#396)。dev push で自動反映。
- 本番 web (`aozoraquest` / `.env.production`) は本番エッジのまま (world-server.ts の else 枝)。

## 補足

- **ALLOWED_ORIGINS** はブラウザ fetch 経路 (dev web / localhost) の CORS 許可のみ。
  `/oauth/callback` と `/client-metadata.json` はサーバー間 fetch なので CORS 対象外
  (ALLOWED_ORIGINS に callback URL を足す必要はない)。
- **WORLD_TOKEN_SECRET** を本番と別鍵にするので、dev の既存位置トークン/セッションは
  無効化される (初回セットアップなので実害なし)。
- wrangler.toml の `REPLACE_WITH_DEV_KV_ID` を実 id に差し替えるまで `wrangler deploy --env dev`
  は失敗する (step 1 → step 3 の順で回す)。

### 6. 確認
- dev.aozoraquest.app でワールド移動/戦闘/リセットが dev エッジ経由で動く。
- 本番 (aozoraquest.app) は無傷 (本番エッジ・本番 KV 不変)。


- **dev エッジをリネーム/再デプロイした時**は、`apps/web/src/lib/world-server.ts` の
  `DEV_EDGE_URL`/`DEV_EDGE_DID` 定数と `.env.development` の VITE_EDGE_URL/DID も直す
  (dev は VITE_NSID_ENV=dev のときコード側の定数でエッジを強制しているため)。

## 再発防止

- dev エッジは dev push で自動デプロイする仕組み (GitHub Actions or CF Workers Build) を検討 (#TODO)。
  それまでは dev エッジのコード変更は `wrangler deploy --env dev` を手動で回す (docs に明記)。
- 本番エッジは main リリース時のみ `wrangler deploy` (top-level)。誤って本番へ出さない運用を徹底。
