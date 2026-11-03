# 23 - ワールドデータを dev から本番へ移す手順（内部用）

## 1. 何のための手順か

- dev の管理データ `app.aozoraquest.dev.world.*` を、本番の `app.aozoraquest.world.*` へ写す。
  - どちらも管理者 DID の repo にある rkey `self` のレコード。
- 使う場面：
  - あおぞらワールドの本番公開（ゲートを開ける前にデータを入れる）。
  - 公開後の内容の更新（新しい章、NPC、クエスト、セリフなど）。
- 道具は `scripts/promote-admin-records.mjs`。dev の値を読んで、`$type` だけ本番の collection に変えて書く。値の中身は変えない。

### スクリプトの仕様（コードで確かめた事実）

- 対象は `PROMOTE_NAMES` の10種だけ：monsters, monsterArt, items, shops, npcs, interiors, quests, scenario, story, dialogue。
  - map・tileArt・jobs は対象外（渡すと「対象外の name」で止まる）。
  - 書き先は `assertProdTarget` で `app.aozoraquest.world.(10種)` に限られる。
- 使い方：`node scripts/promote-admin-records.mjs <name…> --backup-dir <dir> [--execute]`
  - 復元は `node scripts/promote-admin-records.mjs --restore <退避ファイル> --backup-dir <dir> [--execute]`。
  - `--backup-dir` は常に必須。知らない `--` 引数はエラー。
- 既定は **dry-run**。dev と本番を公開の getRecord で読み、名前ごとに「cid・件数・上書きか新規か」を出すだけで、何も書かない。
- `--execute` のときだけ書く。
  - 環境変数 `BLUESKY_ADMIN_IDENTIFIER` と `BLUESKY_ADMIN_APP_PASSWORD` が要る（無ければ止まる）。`ADMIN_DID` で管理者 DID を上書きできる。
  - createSession のあと、ログインした DID が管理者 DID でなければ止まる（`assertAdminDid`）。
  - 名前ごとに、今の本番の値を `--backup-dir` へ `backup-<name>-<時刻>.json` として退避してから putRecord する。本番に無い（新規の）ときは退避しない。
  - putRecord は `swapRecord`（本番の今の cid。新規なら null）つきの CAS。読んでから書くまでに本番が変わっていれば失敗する。
- 名前は**引数に書いた順**に処理する。
- **書く前の検証はしない。** core の検査は、本番 edge が読み込むときに初めて走る（スクリプトは Node 標準だけで、core の .ts を読めないため）。

### 読み込み順（`packages/core/src/admin-nsid.ts` の `ADMIN_WORLD_RECORDS`）

map → tileArt → monsters → monsterArt → items → shops → npcs → jobs → interiors → quests → scenario → story → dialogue

- shops は items の後、quests は npcs・monsters・items の後、scenario は quests の後、story は scenario の後（検証が先のレコードを引く）。
- edge は5分（`CACHE_TTL_SEC = 300`）ごとに全レコードをこの順で読み直す。1件が検証で落ちても後続は止まらず、その名前だけ古い値のまま残る（monsters・monsterArt は KV の last-good に倒れる）。
- 書いている途中は「新しい quests がまだ無い npc を指す」状態がありうる。だから書く順は読み込み順に合わせる。

## 2. 前提

- 管理者の資格情報を環境変数で渡せること（`BLUESKY_ADMIN_IDENTIFIER` / `BLUESKY_ADMIN_APP_PASSWORD`）。値はリポジトリやログに残さない。
- dev 側の取得には `scripts/admin-data.mjs get <name>` を使う（dev edge の管理データ API。鍵は `~/.config/aozoraquest/dev-admin-data-key`、権限600）。
- 本番 edge がそのデータを扱えること。2026-10-25 時点の事実：
  - 台本つき戦闘（ストーリー戦）のコードと、中ボス・第7章のデータに要るものは、本番 edge に v2026.10.25-1 から入っている。
  - 本番 edge の変更や再配備は要らない（データを入れるだけ）。
  - map と tileArt は dev と本番で中身が同じなので、移さない。
- ワールドのゲートは `apps/web/src/lib/world-preview.ts` の `WORLD_PREVIEW_ENABLED`。本番ビルドでは閉じている。開けるのは別のリリース PR。
- 承認：
  - `--execute` で本番へ書くには、オーナーの承認が要る（dry-run の要約を見せてから）。
  - ゲートを開けるリリースには、通常のリリース承認（CLAUDE.md「dev → main の本番リリース」）が要る。

## 3. 手順

`<dir>` は退避先（例：`~/.pi/<作業名>/backup`）。リポジトリの中には置かない。

1. **dev の編集を止める。** 管理画面と `admin-data.mjs put` での dev データの編集を止めてもらう。以後、dev が変わったら2からやり直す。
2. **検証する。** dev の全レコードを core の `loadAdminWorld` に通し、エラーが0であることを確かめる。
   - リポジトリにはこの検証のスクリプトが無い（#828）。今は手元で小さな `.mts` を書いて `tsx` で回している（例：`~/.pi/ch7-evidence/write/final-check.mts`）。
   - 最小の手順：
     - 10種は `node scripts/admin-data.mjs get <name> > <name>.json` で dev の値を取る（出力の `value` を使う）。
     - map・tileArt・jobs は admin-data.mjs の対象外なので、公開の getRecord で `app.aozoraquest.dev.world.<name>` を読む。
     - `@aozoraquest/core` の `loadAdminWorld((n) => 各 value ?? null, (n, e) => { throw … })` を呼ぶ。
     - 例外が出なければよい。章を足したときは、その章を通しで進めるチェックも合わせて回す。
   - TODO: 検証をリポジトリのスクリプトにする（#828）。
3. **dry-run する。**
   `node scripts/promote-admin-records.mjs monsters monsterArt items shops npcs interiors quests scenario story dialogue --backup-dir <dir>`
   - 名前は変えるものだけでよい。並びは読み込み順にする。
   - 出力（上書きか新規か、件数、cid）を保存する。
4. **オーナーの承認をもらう。** dry-run の要約と検証の結果を見せる。
5. **`--execute` で書く。** 3と同じコマンドに `--execute` を付け、環境変数で資格情報を渡す。
   - 順番は読み込み順：monsters → monsterArt → items → shops → npcs → interiors → quests → scenario → story → dialogue。
   - 途中で止まったら（CAS の失敗など）、残りを同じ順で続ける。書けた分の退避ファイルは消さない。
6. **書いた結果を確かめる。** 本番と dev の全レコードを公開の `com.atproto.repo.getRecord`（repo＝管理者 DID、rkey＝`self`）で読み、`$type` 以外が一致することを比べる。
7. **本番 edge のログを見る。** 最大5分（TTL）待ってから本番 edge（`aozoraquest-edge`）を `wrangler tail` し、`authored world: <name> failed` が出ないことを確かめる。
   - 出たら、その名前は古い値（または last-good）のままになっている。dev のデータを直して2からやり直すか、§4 で戻す。
8. **実際の画面で確かめる。** 本番の /world（ゲートが開いている場合）を 390px で開き、変えた所（会話・NPC の絵・戦闘・クエスト）を触る。
   - ゲートが閉じている本番ビルドでは「準備中…」しか出ない。公開前は、ゲートを開けるリリース直後に確かめる。

## 4. 戻し方

- **上書きした名前**：`--backup-dir` の退避ファイルから戻す。
  `node scripts/promote-admin-records.mjs --restore <dir>/backup-<name>-<時刻>.json --backup-dir <dir>`（dry-run で確かめてから `--execute`）
  - 書き戻しも今の本番 cid で CAS し、書き戻す前の値をさらに退避する。
  - 1回に1ファイル。複数あるときは1件ずつ打つ。
- **新しく作った名前**：退避が無く、スクリプトには消す手段が無い。
  - 公開前・公開直後なら、まずゲートを閉じる（ゲートを開けた PR を revert してリリースする）。
  - レコード自体を消すときは、管理者の資格情報で `com.atproto.repo.deleteRecord`（collection＝`app.aozoraquest.world.<name>`、rkey＝`self`）を手で打つ。オーナーの承認が要る。
- 戻したあとも §3 の6〜7で確かめる。

## 5. 注意

- **gameState は dev と本番で共有。** `app.aozoraquest.gameState` は ns の前置きが無い1つの権威レコード。dev で遊んだ人は本番でも続きから始まる。データを戻しても進行は戻らない。
- **公開後の編集は dev で行い、この手順で本番へ移す**（オーナーの決定）。本番の管理画面（/admin/*）で直接保存すると本番の world.* へ書かれ、dev とずれるので使わない。
- **NPC の画像は同じ repo の blob。** spriteImage・portraitImage・expressionImages は管理者 repo の blob なので、レコードを写せば本番でも同じ参照で出る。新しい画像は dev で `admin-data.mjs npc-image` で上げてから移す。
