# ゲーム内容のデータ化 — PDS レコード + blob (設計案)

エピック #416 / issue #418。オーナー決定 (2026-07-20): ゲーム内容の保存先は **ATProto PDS
レコード + blob**。この doc はスキーマ・読み書き経路・移行の設計案で、レビュー後に #419 以降
(モンスター等の CRUD) を実装する。

> ステータス: **草案 (オーナーレビュー待ち)**。§9 の「要決定」に○を付けてから実装に入る。

---

## 1. 背景と原則

現状、モンスター (`MONSTERS`)・装備 (`EQUIPMENT`)・アイテム (`ITEMS`) は `packages/core` に
**コード直書きの静的データ**。管理者が CRUD で追加・画像アップロードするには編集可能なストアへ
移す必要がある。

**原則:**
1. ゲーム内容は**全プレイヤー共通のグローバルデータ** → 単一の正本 (canonical repo) を持つ。
2. 戦闘は**サーバー権威** (edge が敵ステータスを再導出。docs/21)。→ **client と edge が同じ内容を
   決定論的に読める**こと。
3. 書き込み (CRUD) は**管理者のみ**。UI の `isAdminDid` は認可ではない → **edge/サーバー側で検証**。
4. 静的データからの移行は**決定論・既存テストを壊さない**。

---

## 2. 保存先: サーバーアカウントの PDS

ゲーム内容は**サーバーアカウント (権威 state の持ち主、kojira.io) の PDS** に置く。理由:
- world state (docs/21 M3) と同じ正本。edge は既にこの PDS を **public getRecord で読み**、
  **OAuth (DPoP) トークンで書ける** (server-oauth)。同じ経路を流用できる。
- グローバルな 1 正本なので、client も edge も同じレコードを読む = 決定論が自然に成立。

**dev/prod 分離**: エッジは分離済み (#393)。content も `COL` の `USER_PREFIX` と同じく
**env suffix で分離**する (dev の content 編集が prod に漏れない)。
- prod: `app.aozoraquest.content.monster`
- dev: `app.aozoraquest.dev.content.monster`

---

## 3. レコード設計 (lexicon)

1 コンテンツ種別 = 1 コレクション、**1 エンティティ = 1 レコード** (rkey = エンティティ id、
例 `sky-slime`)。フィールドは既存の静的型 (`MonsterDef` / `EquipmentDef` / `ITEMS`) を踏襲。

| コレクション (NSID) | rkey | 主フィールド |
|---|---|---|
| `{P}.content.monster` | `sky-slime` 等 | name, species, tier, stats[5], hp?, mp?, xp?, spawnWeight?, tint?, drops[], intro, ability?, skillName?, healName?, **image (blob)** |
| `{P}.content.item` | `wp-knife`/`herb` 等 | kind (equipment/consumable/material), name, slot?, bonus?, grade?, price?, jobOnly?, effect?, **image/icon (blob)** |
| `{P}.content.map` | エリア id | 地形/街/危険度/エリア境界/出現セット参照 (#421 で詳細) |
| `{P}.content.spawnSet` | セット id | モンスター id + 重み の配列 (#412 出現セット) |
| `{P}.content.shop` | 店 id | ラインナップ (item id[])、合成レシピ (素材の組合せ)、店主名・セリフ (#422) |
| `{P}.content.quest` | クエスト id | 達成条件・報酬・強制/任意 (#423) |

`{P}` = `app.aozoraquest` (prod) / `app.aozoraquest.dev` (dev)。

**設計メモ:**
- rkey にエンティティ id を使う → 参照 (drops の item id、shop の item id、map の spawnSet id) が
  安定。存在検証は「その rkey のレコードがあるか」。
- レコードには `updatedAt` と **`schemaVersion`** を持たせ、移行・キャッシュ無効化に使う。

---

## 4. 画像 = PDS blob

- 管理者が画像をアップロード → **サーバー PDS に `uploadBlob`** → blob CID をレコードの `image`
  フィールド (blob 参照) に格納。
- client は blob を PDS の `getBlob` (public) で取得。SVG/PNG 両対応。
- 既存モンスターはコードで SVG 描画 (species ベース)。移行後も **image blob が無ければ従来の
  species SVG にフォールバック** (段階移行・見た目の互換)。

---

## 5. 読み取り経路とキャッシュ (決定論の要)

### client
- 起動時/世界入場時に content コレクションを `listRecords` で取得 → メモリにロード。
- 現状の `MONSTERS`/`EQUIPMENT`/`ITEMS` 直参照を **loader 経由 (`loadContent()`)** に置き換える。
  loader は PDS content を返し、**未取得/失敗時は静的データにフォールバック** (§7 移行)。

### edge (権威)
- 戦闘再導出時、edge は content を **public getRecord/listRecords で読み、KV に短期キャッシュ**
  (TTL + `schemaVersion`/`updatedAt` でバスト)。
- **決定論**: client と edge が同じ正本 (サーバー PDS の同じレコード) を読むので、id が一致すれば
  戦闘値が一致する (現状 `battleXpFor(monsterId)` 等と同じ担保)。編集直後の一瞬の不整合は
  キャッシュ TTL で収束 (戦闘中に敵定義が変わる頻度は低い)。

**要検討 (§9)**: client は PDS を直読みするか、edge 経由の集約 API から読むか。直読みは速いが
PDS レート/blob 取得が分散。edge 集約はキャッシュ一元化できるが edge に読み API が要る。

---

## 6. 書き込み (CRUD の認可)

管理ダッシュボード (#417) の CRUD は:
1. 管理者が UI で編集 → **edge の管理 API** (`/api/content/...`) に service-auth JWT (ADMIN_DIDS
   検証、OAuth start と同じ方式) で送る。
2. edge が**管理者を検証**し、サーバーアカウントの OAuth トークンで content レコードを
   `putRecord`/`deleteRecord`、画像は `uploadBlob`。
3. 書き込み後、キャッシュ (KV) をバスト (`schemaVersion` 更新)。

→ **UI の isAdminDid は入口の表示ゲート。実際の認可は edge が握る** (詐称防止)。

---

## 7. 移行 (静的 → PDS、決定論維持)

1. **静的データは残す** (seed 兼フォールバック)。`MONSTERS`/`EQUIPMENT`/`ITEMS` は削除しない。
2. **seed スクリプト**: 静的データをサーバー PDS に content レコードとして一括書き込み (初期投入)。
3. **loader 導入**: `loadContent()` が PDS を読み、失敗/空なら静的データを返す。consumer を
   段階的に静的直参照 → loader に移す。
4. **テスト/決定論**: 単体テスト・sim は静的 seed を使い続ける (PDS I/O をテストに持ち込まない)。
   edge の再導出テストも静的 seed で。PDS 化は「実行時に管理者が上書きできる」層として被せる。

---

## 8. 段階実装 (サブ issue 対応)

1. **この doc のレビュー合意** (#418)。
2. lexicon + loader + seed スクリプト + edge 読みキャッシュ + 管理 API 骨組み (#418 実装分)。
3. **#419 モンスター CRUD + 画像** (最初の CRUD。loader/管理 API を実証)。
4. #420 アイテム / #421 マップ・出現セット / #422 店 / #423 クエスト を順次。

---

## 9. 要決定 (オーナーレビュー)

- [ ] **保存先**: サーバーアカウント PDS の content コレクション (§2) でよいか。
- [ ] **dev/prod 分離**: env suffix (`app.aozoraquest.dev.content.*`) で分けるか、共有か。
- [ ] **client の読み経路**: PDS 直読み vs edge 集約 API 経由 (§5 要検討)。推奨は当面 **PDS 直読み +
      静的フォールバック** (シンプル)、edge キャッシュは権威側のみ。
- [ ] **画像フォールバック**: image blob 無しは従来の species SVG に落とす (§4) でよいか。
- [ ] **移行の入口**: seed スクリプトを一度流す運用 (§7) でよいか。
