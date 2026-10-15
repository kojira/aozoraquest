# D-ADMINENV-006: 管理データの保存先をステージングと本番で分離する (#716)

承認: オーナー「保存先の分離を進めて」。昇格ツール (dev→本番) は対象外 (案 B、リリース準備時に別途)。

## 規則

| 環境 | 管理データ (world.* / config.*) | 決め方 |
|---|---|---|
| 本番 web (`VITE_NSID_ENV` 未設定) | `app.aozoraquest.<x>` (変更なし) | `ADMIN_COL` |
| dev web / ローカル / e2e (`VITE_NSID_ENV` が空でない) | `app.aozoraquest.dev.<x>` | `ADMIN_COL` |
| 本番エッジ (top-level) | `app.aozoraquest.<x>` (変更なし) | `ADMIN_NSID_ENV` 未設定 |
| dev エッジ (`[env.dev]`) | `app.aozoraquest.dev.<x>` | `[env.dev.vars] ADMIN_NSID_ENV = "dev"` |
| CLI `scripts/admin-data.mjs` | dev エッジ経由のみ | エッジが返す collection が dev 以外なら止まる |

- ローカルの `VITE_NSID_ENV=local` も `.dev.` を読む: ローカル web も dev エッジを叩き、エッジのワールドは isolate ごとの単一キャッシュ (1 つの root) なので、web と edge で同じデータを読まないと移動判定がずれる (#421 と同種)。
- dev にレコードが無い時は同梱の既定に倒れる (本番が無い時と同じ)。**本番へのフォールバックはしない** (結合し直すため)。
- エッジの root は Origin ではなく Worker の env で決める: 本番エッジと dev エッジは別 Worker (docs/22)。

## 対象 / 対象外

- 対象: world.map / tileArt / monsters / items / shops / npcs / quests / jobs / interiors / scenario、config.flags / maintenance / bans / prompts。
  web `ADMIN_COL`、edge `world-authoring.ts` (`adminNsidRoot`)・`admin-data.ts`・`npc-image.ts`・`index.ts`・`router.ts` の読み込み呼び出し。
- `directory` は共有のまま: `.github/workflows/directory-refresh.yml` が毎時、本番 Environment で #aozoraquest のオプトイン投稿から自動生成する公開一覧で、手で作る管理データではない。分けると dev の一覧が空のまま更新されない。
- `questIndex` は共有のまま: 既に rkey で env 分離済み (`QUEST_INDEX_RKEY`)。
- RPC/LXM の NSID (`world.move` 等) は保存先でないので変えない。`apps/admin` (旧管理 SPA、デプロイ対象外) は触らない。

## 初回複製 `scripts/copy-admin-data-to-dev.mjs`

- 既定は dry-run (listRecords で読むだけ・一覧を出す)。`--execute` + `BLUESKY_ADMIN_IDENTIFIER` / `BLUESKY_ADMIN_APP_PASSWORD` の時だけ書く。
- 本番の各レコードを同じ repo・同じ rkey の dev collection へ `createRecord` (既存なら作らない = 上書きしない)。書き先は `app.aozoraquest.dev.` で始まることを書く直前に検査。本番には書かない。
- 値は `$type` だけ dev の collection に変える。blob 参照は同じ repo の blob を指すので有効なまま (npcs の 2 件を getBlob で 200 を確認)。

## 配備順

1. 複製を実行 (dev collection を作る。本番は読むだけ)。
2. dev エッジを手動配備 (`wrangler deploy --env dev`)。
3. この PR を dev へ merge (dev web が `.dev.` を読む)。
4. 確認: dev エッジ `GET /api/admin/data/npcs` の `collection` が `app.aozoraquest.dev.world.npcs`、cid が複製後の dev cid。本番 collection の cid が複製前と同じ。

1→2 の間は dev エッジが旧 root を読むだけで影響なし。2→3 の間は dev web (旧) と dev エッジ (新) が別 root を読むが、1 で同じ内容を複製済みなので一致する (この間は管理画面・CLI で保存しない)。
