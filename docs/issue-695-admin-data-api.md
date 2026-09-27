# #695 管理データをコード修正なしで直す dev 専用 API と CLI

> **警告: このルートは本番と共通の管理データを書き換える。**
> `app.aozoraquest.world.*` の管理レコードは env で分かれていない (web の `ADMIN_COL` と
> edge の `nsidRoot` が同じ 1 か所を読む)。dev edge から書いた内容は、本番の web / edge も
> 次の読み込み (最大 5 分) で拾う。管理画面からの保存と同じ重さで扱うこと。

## 目的

村人の位置・店・クエストなどの管理データを、毎回コードを直してデプロイしなくても、
ローカルのエージェントが CLI から読み書きできるようにする。管理画面 (ブラウザ OAuth)
を使えない CLI からでも、管理画面と同じ検証を通した書き込みだけを許す。

## 事実 (設計の前提)

- dev edge の `server-oauth` トークン (KV) の DID は `did:plc:47skrewud2vjha6o57wzzxjw`
  (kojira.io) で、`ADMIN_DIDS` の先頭 = 主管理者と同一。`serverPutRecord` はこの repo に
  `swapRecord` 付きで書ける (repo はトークンの DID に固定)。
- 管理レコードを書く既存の edge API は無い (管理画面はブラウザのセッションで直接 putRecord)。
- 検証関数は core にある (`validateNpcs` / `setShopOverrides` / `setInteriors` /
  `validateGameQuests` / `validateScenario` / `danglingRefs`)。NPC の配置検証だけ web
  (`apps/web/src/lib/npc-placement.ts`) にあったので、中身を変えず core へ移す。

## 設計

### エンドポイント (dev edge のみ)

- `GET /api/admin/data/<name>` → `{ name, collection, cid, value }`
  (`cid`/`value` はレコードが無ければ `null`)。
  - `npcs` のときは `placementIssues` (全 NPC の配置問題、`[{ id, reason }]`) も返す。保存時は動かした NPC しか
    配置検証しないので、地図の差し替えで屋根の上に取り残された NPC などを見つける入口。
- `PUT /api/admin/data/<name>` body `{ value, swapCid, dryRun? }`
  1. 保存済みの管理レコード (map / tileArt / items / monsters / jobs / npcs / interiors /
     shops / quests / scenario) を読み直して core に入れ、対象だけ候補値に差し替える。
  2. 管理画面と同じ検証を通す。1 件でも壊れていれば 400 (`{ error: "validation_failed", message }`) で理由を返す。
     - npcs: `validateNpcs`、参照切れ (`danglingRefs('npc')`)、全 NPC の構造検査
       (`npcStructuralPlacementError`)、**新規または位置が変わった NPC** の配置検査
       (`validateNpcPlacement`: 歩けるマス・街や施設の入口でない・重なりなし)。
     - shops: `setShopOverrides`。
     - interiors: `setInteriors` (タイルは gzip+base64 の保存形式のまま受け取る)。
     - quests: `validateGameQuests`、参照切れ (`danglingRefs('quest')`)。
     - scenario: `validateScenario`。
  3. `dryRun: true` ならここで `{ ok: true, dryRun: true }` を返す。**既定は書き込む**
     (dryRun は明示したときだけ)。
  4. `serverPutRecord(..., swapRecord = swapCid)` で書く。`swapCid` は必須
     (レコードが無いときは `null` = 未作成のときだけ作る)。CID が変わっていれば 409 (`swap_conflict`)。成功は `{ ok: true, cid }`。
  5. 書いたら edge のキャッシュを捨てる (`resetAuthoredWorldCache`)。
- 対象は `npcs` `shops` `quests` `scenario` `interiors` の 5 つだけ
  (collection は `app.aozoraquest.world.<name>`、rkey は `self`)。それ以外は 404。
  地図・絵・アイテム・モンスター・ジョブは対象外 (必要になった時点で別 Issue)。
- 書き込む値には `updatedAt` と `$type` を edge が付け直す。
- 読み書きする repo はサーバー OAuth トークンの DID。これが `ADMIN_DIDS` の先頭 (世界を読む主管理者) と
  違う・トークンが無い時は 503 で止める (読む repo と書く repo をずらさない)。

### 有効化と認証

- `[env.dev.vars] ADMIN_DATA_API_ENABLED = "1"` **かつ** dev secret `ADMIN_DATA_API_KEY`
  がある時だけ動く。prod はどちらも無いので常に 404。
- `Authorization: Bearer <key>` を定数時間比較する。
- 無効・鍵なし・鍵違いは、どれも **存在しない URL と同じ最小の 404** を返す
  (エンドポイントの存在を明かさない)。
- 鍵はローカルの `~/.config/aozoraquest/dev-admin-data-key` (chmod 600) にだけ置く。
  鍵の値をログ・PR・Issue・チャット・コマンド出力に出さない。サーバーの OAuth トークンは
  ローカルに持ち出さない (書き込みは edge 内で完結する)。

### CLI `scripts/admin-data.mjs`

依存なしの node スクリプト。

```
node scripts/admin-data.mjs get <name>                   # JSON を標準出力へ
node scripts/admin-data.mjs put <name> <file> [--dry-run] # 差分要約を出してから書く
node scripts/admin-data.mjs npc-move <id> <mapId> <x> <y> [--dry-run]
```

- `put` / `npc-move` は直前に `get` した `cid` を `swapCid` に使う (その間に誰かが保存
  していれば 409 で止まる)。書く前に差分の要約 (追加・削除・変更の件数と id、NPC は
  位置の変化) を出す。要約と結果は標準エラー、`get` の JSON だけ標準出力。
- `npc-move` の `<mapId>` は内部マップ id、フィールドは `world`。
- 404 は「無効・鍵違い・対象外 name」のどれか (区別は返らない)。
- 鍵ファイルのパーミッションが 600 でなければ実行しない。
- `--help` と実行時の表示に「本番と共通の管理データを書き換える」を出す。
- 接続先は既定で dev edge (`https://aozoraquest-edge-dev.kojiran.workers.dev`)。
  `AQ_ADMIN_DATA_EDGE` で上書きできる。

## セットアップ (親の承認後に行う)

1. 鍵を作ってローカルに置く (値を表示しない)。
   ```
   mkdir -p ~/.config/aozoraquest
   ( umask 077; openssl rand -base64 48 | tr -d '\n' > ~/.config/aozoraquest/dev-admin-data-key )
   chmod 600 ~/.config/aozoraquest/dev-admin-data-key
   ```
2. dev の secret に入れる (標準入力から渡し、値を画面に出さない)。
   ```
   cd apps/edge
   export CLOUDFLARE_ACCOUNT_ID=b9cec3916d500760a7c7b9c31c720d80
   pnpm exec wrangler secret put ADMIN_DATA_API_KEY --env dev < ~/.config/aozoraquest/dev-admin-data-key
   ```
3. dev edge をデプロイする: `pnpm exec wrangler deploy --env dev --keep-vars`。

## 使い方の例: 屋根の上の村人を動かす

```
node scripts/admin-data.mjs get npcs | jq .placementIssues
node scripts/admin-data.mjs npc-move npc-2 starter-town 12 14 --dry-run
node scripts/admin-data.mjs npc-move npc-2 starter-town 12 14
```

## 検証

- edge: 無効・鍵なし・鍵違い → 404 (本文は通常の not_found と同じ)、対象外 name → 404、
  検証エラー → 400、配置エラー → 400、swap 競合 → 409、dryRun は書かない、成功時は
  swapRecord 付きで putRecord。
- core: 移した `npc-placement` の既存テストをそのまま core で通す。
- web: 旧パスからの再エクスポートで既存の import と挙動を変えない。

## 対象外

- 地図・絵・アイテム・モンスター・ジョブの書き込み。
- dev 専用コレクションへの分離 (管理データは env 共有のまま)。
- 本番 edge での有効化。
