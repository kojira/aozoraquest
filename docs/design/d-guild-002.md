# D-GUILD-002 — ゲーム内依頼の複数同時受注

Issue [#707](https://github.com/kojira/aozoraquest/issues/707) / Draft PR [#708](https://github.com/kojira/aozoraquest/pull/708)。設計正本。調査基準: `feature/futaba-guild-d001`、`0eb98082d669d0715f3772dbfd18fc4541df39f3`。

## 最新の決定（後続reviewer必読）

1. ユーザー: **「複数依頼受けられないとまずいね。ストーリーが一本道になってしまうし、組むのが逆に大変になるよ」**。一般の複数受注へ進む。ギルド専用枠ではない。
2. 本設計調査中の追加指示: **「まだリリースしてないから今の状態を壊しても問題ないよ」**。従前handoffの「既存active ID/進捗を移行で必ず保持」は撤回。未リリース前提で破壊的に切り替えてよい。稼働本番保護を想定した互換配備を作らない。
3. 続く追加指示: **「余計な仕組み入れないでね」**。単一questを複数保持へ置換し、既存受注/討伐/報告/表示を対応する最小差分とする。互換レイヤー、二重保存、専用slot、汎用移行/workflow基盤、未要求の上限/放棄/履歴再設計は入れない。

**状態: 独立設計レビュー/親採用後に実装・隔離QC済み。fresh実装レビューとCI確認、実入口の配備/データ反映は別ゲート。** D-GUILD-001の「受注方針回答待ち」「複数受注未承認」を上記決定で置換する。旧状態保持を目的としたlazy移行・schema marker・feature flag・protocol negotiation・旧client投影・全writer停止/ドレイン案は採用しない。main/merge/deploy/共有PDS書込の承認は依然ない。「壊してよい」は無関係な管理マップ/NPC/画像/ポイント等の一括削除の承認ではない。

## 1. 成果と非対象

- ギルド・直接NPCの独立した依頼を同時に受け、一覧で進捗を見て、選んだ1件を報告できる。同じIDは重複受注しない。新たな受注件数上限を設けない。
- `requireFlags` / `requireItems` を受注条件として保持。既存3依頼の物語連鎖を解除しない。独立した `futaba-tool-care` は村長への討伐報告を待たない。
- 依頼進行の権威は `GameState.activeQuests` だけ。clientは応答の写しを表示するだけ。完了判定は既存 `questsDone`、物語判定は既存 `flags` を継続。
- 報告時の最新在庫チェック・消費/報酬/完了のCAS・同一依頼の二重報酬防止を保持する。
- 救護/2表情/初期付与/map内会話/建物/扉/退出ラッチ/管理portrait優先/radius8遭遇限定/承認済み依頼内容と報酬を保持。
- 辞退/破棄機能、在庫予約、新クエスト種別、自動生成、一括報告、他街ギルド化、戦闘報酬基盤の改修、ユーザー間/投稿系クエストは対象外。
- 現行カタログ上限200件は定義の既存制約であり、受注枠数ではない。今回変更しない。完了履歴200件リングの再設計は別Issue [#709](https://github.com/kojira/aozoraquest/issues/709)。

## 2. 現行production seam（調査済みの事実）

行番号は上記HEAD。schemaだけでなく実呼出しまで照合した。

|責務|現在の実経路/制約|今回の変更|
|---|---|---|
|定義/受付検索|`packages/core/src/quest-data.ts:62-143`。validatorが1 NPC 1件を強制、`byNpc`/`gameQuestByNpc` は単体|同NPCの複数定義を許可、`gameQuestsByNpc(npcId): readonly GameQuestDef[]` に統一。定義順を保持、ID重複拒否は維持|
|受注|`apps/edge/src/game-quest.ts:40-71` → RMW。単一 `quest`、他依頼で `quest_busy`|active配列へID追加。同一IDはno-op。他件は保持|
|報告|同 `:74-139`。body IDを `cur.quest.id` と照合、collect消費/報酬/完了/flagsを同一CASで確定|選択IDだけ検証/削除/報酬。既存CASを再利用|
|認証/API|`apps/edge/src/router.ts:480-503`。service auth issが対象DID、accept/complete別lxm、`questId`必須、定義読込後handler|認証/入力は無変更、返却DTOの配列化のみ|
|討伐|`apps/edge/src/battle-reward.ts:108-154`。報酬対象winで敵ID列から単一依頼だけ加算|matching受注defeat全件を加算|
|決着|`apps/edge/src/battle-resolver.ts:631-762`。guard CAS削除後RMW、`written.quest` 応答。`router.ts:178-180` が定義読込を待つ|既存guard/報酬を保持、決着応答を配列化|
|collect進捗|`packages/core/src/quest-data.ts:160-165` の `questProgressLine` は現在在庫を参照|全依頼を同じ在庫から再計算。個別取り置きなし|
|client mirror|`apps/web/src/lib/game-quest.ts` の `QuestState.active`、`questStateOf`、`questAfterBattle`、`activeQuest`、`questMenuLine`、`questBusyLines`|配列へ置換。単一busy表示/単一helperを除去|
|wire型/呼出|`apps/web/src/lib/world-server.ts:104,123-125,226-246,285以降`。state/accept/complete/turn DTO|単一questをactiveQuestsへ置換。旧形式fallbackなし|
|World load/update|`world.tsx:423-440,598-629,940-956`。GET、受注、決着からmirror。受注失敗後に「何かactive」で会話終了する分岐あり|全件mirror、失敗後は送信したIDだけ照合|
|ギルド|`world.tsx:631-708`。`guildQuest`単体、report ID固定|実定義一覧と明示ID選択|
|直接NPC|`world.tsx:748-803`。単体検索/解禁filter、activeは即report、別activeはbusy|候補配列。複数候補時は選択、1件時の物語導線保持|
|メニュー|`world.tsx:1739` → `components/world-menu.tsx:20-54` の `questLine` 1行|同じ入口で全受注の一覧表示|
|load/write|`apps/edge/src/game-state.ts:19,109-114,123-140,153-174,199-228`。固定collection、normalize、CAS、no-opはputなし|型と初期値の配列化。配列なしは空扱い、旧questは無視/除去|
|新規/reset|`battle-resolver.ts:182-216` の `migrateInitState` はemptyStateベース。`:226-233` は本人guard/stateをCAS削除。web `lib/onboarding-reset.ts:144` が最後にserverReset|新規active空配列。resetの範囲/意味を変えない|
|他のstate書込|`battle-resolver.ts` 移動境界/街/遭遇/teleport/item/search/gear、`shop.ts` craft/sell/forge/discard、`xp-claim.ts` claim/adminSet/spend/adminGrantは共通RMW|既存spreadで配列保持。個別のquest保存処理を足さない|
|物語|`apps/edge/src/scenario-progress.ts:30` → core `scenario.ts:150-157` はquestsDone参照|イベント/依存/flags無変更|
|shared定義|edge `world-authoring.ts:148-154`、web `lib/world-authoring.ts:219-226,349-352,369-373`、edge `admin-data.ts:117-120` はcore validator使用|共通validatorの1NPC制約だけ撤去。定義の同梱強制混合なし|
|管理画面|`apps/web/src/routes/admin-quests.tsx` は既に配列で編集、保存はcore validator|新たな管理state不要。同NPC2件保存/読込の回帰確認|

本人PDS `apps/web/src/lib/world-state.ts` の `COL.world/self` は位置/探索メモでquestを保存しない。WorldのscheduleSave/アンマウント保存を依頼権威にしない。`routes/quests.tsx`、`lib/quest-api.ts`、UserQuest/投稿クエストは別機能で対象外。gameStateのputは共通RMW、deleteは本人resetに集約される。

## 3. ユーザーが触る体験

### 3.1 自分をタップ→コマンド

既存WorldMenuの単一依頼行を「受注中の依頼 N件」の全件一覧に置換する。別画面/新workflowは作らない。各行はタイトル、報告先、目的/進捗。受注順。0件は「受注中の依頼は ありません」。一覧部分だけ高さを制限してスクロール可能にし、コマンド/閉じるをmap内に残す。表示件数を切り捨てない。

- defeat: `2/3`、達成時「報告できます」。説明「同じ敵の依頼は、受注しているものすべてに数えます」。
- collect: 「所持 2 / 必要 2」「報告すると2こ渡します」。共通説明「所持品は ほかの依頼・どうぐ・制作と共通です。報告すると減ります」。現在2/2の依頼が2件あっても各2個確保した意味ではない。「確保済み」「納品済み」と表示しない。
- 定義が消えた受注IDは、他の受注を妨げない。記録は残し「依頼情報を確認できません（ID）」と表示、報告なし。定義復帰時に元の状態で表示できる。自動破棄/辞退機能は作らない。

### 3.2 ギルド

既存扉→再会→4メニューを維持。

- 「依頼を見る」は `gameQuestsByNpc(受付npc.id)` の実定義。未受注は条件を満たすもの、受注中はその状態を表示。達成済みは出さない (一人一度の依頼。説明を読み直させない)。条件未達の未受注は従来同様物語から隠す。shared空なら「いま 紹介できる 依頼は ないよ」。同梱を強制追加しない。
- ギルドの「依頼を見る」「報告する」にも§3.3の同名識別（目的、なお同じならID）を適用する。タイトル一意制約や新stateは追加しない。
- タイトル選択→現行詳細（intro/条件/報酬/納品消費）→未受注のみ「受注する / 戻る」。成功メッセージ→受付。
- 「報告する」はこの受付の受注中依頼。1件でも常に一覧「どの依頼を 報告する？（1/N）」でタイトル/進捗を選ぶ（3件ごとに前へ/次へ、戻る）。選んだら説明・確認なしでそのまま報告する。未達の依頼も一覧に出し、選ぶと既存の不足表示。0件は「いま 報告できる 受注中の依頼は ないよ」。(#747) 達成済みは「依頼を見る」にも出さない。
- 選択IDだけPOST。未達なら最新不足表示、成功ならその依頼のお礼/応答の報酬/通知だけ。次の報告一覧は消費後の在庫で再計算。
- 「話す」は既存 `npcLinesFor` のlines/altLines。「戻る/取消/読了」は受付、「やめる」だけ退出。既存ラッチを保持。
- 多数の候補はWorld側で3件ずつのページにし「前へ/次へ/戻る」を付け、既存DialogueWindowの選択APIを使う。これは表示ページであり受注上限ではない。タイトルを折り返し、全ページへ到達できることを小画面で確認する。

### 3.3 直接NPC

候補は、そのNPCの「受注中」＋「未完了かつ受注条件成立の未受注」。受注時条件を失った受注中依頼も消さない（現行edge reportは受注と達成条件を見ており、受注条件の再確認はしない）。

- 0候補: 従来 `npcLinesFor`。通常台詞のflags/持ち物分岐を保持。
- 1候補: 未受注は従来intro→はい/いいえ。受注中は話しかけると従来通りその1件をreport試行、不足なら進行台詞。**別NPCの依頼があっても受注可能**。
- 2候補以上: 「どの依頼のこと？」→タイトル/状態の選択＋「話す/戻る」。未受注ならそのintro/確認、受注中なら選んだIDだけ報告。完了/取消後は候補一覧へ。表示ページはギルドと同じ。先頭の自動報告をしない。
- 同名タイトルは目的を併記し、それでも同じ場合だけIDを補って選択を区別する。
- `futaba-herbs` は `futaba_slimes_done`、`futaba-wings` は `futaba_herbs_done` を引き続き要求。独立guild報告でこれらのflagsを勝手に立てない。

### 3.4 通信失敗/再送

既存busy/背後入力遮断を維持。受注/報告中は別選択・移動を許さない。結果不明ならGET stateを取り直し、**送ったID**がactive/doneかを見る。他のactiveがあるだけでは成功としない。未確認の報酬を演出しない。再取得失敗時は最後に確認できたmirrorを残して再試行を案内。再送は同じIDを使いサーバーで再評価する。

## 4. データ・load/write・旧保存の扱い

### 4.1 唯一の進行権威

```ts
// GameState: quest を削除して置換する。
activeQuests: Array<{ id: string; progress: number }>;
// questsDone / flags / materials / power 等は既存のまま。
```

- `activeQuests` のIDは一意、順序は受注順。defeatのprogressはサーバーのみ加算。collectは従来同様在庫判定で、progress値は0のままでよい。
- `GameState.quest`、clientの単一active、単一NPC lookupをproductionから除く。旧questを新配列へコピー/同期/投影しない。
- 新schema marker、protocol version、feature flagは追加しない。既存 `version` / `xpEpoch` を新たな移行機構に転用しない。

### 4.2 最小の破壊的切替

- `emptyState` は `activeQuests: []`。`migrateInitState` はそれを利用し、初期付与/位置等は変更しない。
- `readState` の既存正規化境界で、activeQuestsが無い保存は `[]` とする。旧questのID/討伐数は引き継がない。**失われるのは旧単一受注の記録/進捗**。必要なら新版で再受注する。既存done/flags/在庫/パワー/装備等は変更する理由がないためそのまま。
- 旧quest propertyは正規化結果から外し、次の通常RMWで保存するときも含めない。GETだけでPDS書込を増やさない。既存no-opのput省略/CAS retryを保持。初期化callbackの返値も同じ空配列規約にする。
- 既存XP正規化のearly returnで配列初期化が抜けないよう、XP処理の結果にこの小さなdefault処理を適用する。汎用migration registry等は不要。
- 新しい配列がある場合はそれだけを読む。旧questが混在しても足し合わせない。成功したaccept/complete/battleはこの配列だけを書き、他のRMWは既存spreadで保持。
- 不明定義IDは配列から勝手に捨てない。保存容量不足等のwrite失敗は既存エラー経路で元stateを保持、切捨てで対応しない。
- 本人resetは現在通りguard/gameState全体を削除する機能であり、今回の切替に必須ではない。旧activeを空扱いにすれば試験を開始できる。最初からの体験を試す必要がある場合だけ、親が対象テストプレイヤーへの既存reset実行を別に判断する。管理データや全員のstateを一括削除しない。

## 5. 受注・討伐・報告・API契約

### 5.1 受注

既存 `POST /api/quest/accept { questId }` をそのまま使う。定義存在、done、同一ID受注済み、受注条件の順で判定。既受注はno-opで進捗保持（受注後に条件アイテムを使った再送でも0へ戻さない）。別IDは `{id, progress:0}` を追加。他のactiveを理由に拒否しない。上限/quest_busyを残さない。

### 5.2 共通討伐イベント

`applyBattleOutcome` の現行「報酬対象win」の敵ID列を使い、各受注中defeatに対して対象monsterIdの数を加算。

例: A=sky-slime3、B=sky-slime5、C=bat2、D=collectを受注中にsky-slime2匹相当の勝利イベント → A+2/B+2/C+0/D不変。どれかが達成しても他を止めない。受注前の勝利を遡及しない。保存progressは現行同様加算、表示だけ目標数でclamp。

対象となる受注状態は**決着RMW時点**。guardへのquest snapshot追加は不要。未報酬練習、lose/draw/fled/monster-fledの扱い、群れの既存敵ID抽出/fallback、勝敗分類、guardの一度限り確定を変えない。「同じ敵の討伐が複数依頼に数えられる」は明示した仕様であり、隠れた副作用にしない。

### 5.3 選んだ1件を報告

既存 `POST /api/quest/complete { questId }`。ID省略から先頭を選ばない。service auth/lxm/対象DID/定義からの報酬は現在のまま。clientから金額/在庫/進捗/他人DIDを受け取らない。新たな位置署名や受付認可APIを足さない。

同じRMW callback内で:
1. doneなら `already_done`、配列内に対象IDがなければ `not_accepted`。
2. defeatはそのIDの数、collectは最新 `materials[itemId]` を確認。不足なら `not_ready`、消費/報酬/putなし。
3. collectの必要数だけ消費してから、その定義の報酬だけ加算。必要素材と報酬素材が同じでもこの順。既存報酬上限を維持。
4. activeからそのIDだけ削除、既存ルールでdoneに追加、power更新、結果に `advanceScenario` 適用。消費/報酬/完了/flagsを1つのCAS putで確定。
5. CAS競合なら最新を再読込して1から再評価。成功putの結果だけ応答。

具体例: A/Bともslime-drop2、所持2で同時report → 一方だけ成功し2消費/その報酬、他方は最新在庫不足で受注中のまま。所持4なら双方順に成功可。同一IDを並行report/再送 → 1報酬だけ。別操作で材料を使った場合も最新RMWで不足判定。画面に2/2と出ても予約ではない。

### 5.4 応答とmirror

- GET state、accept、completeは `activeQuests` と `questsDone`。completeのpower/materials/flags/notices/rewardedは既存のまま。旧questは返さない。
- 決着turnは `activeQuests` と `questsDone` の全件snapshotを返す（空配列も明示）。未決着では省略し、clientは現在のmirrorを保持。「配列欠落」と「空配列」を区別。
- clientはGET/accept/complete/決着成功時に全件置換し、ローカルで討伐数を増やさない。在庫更新で全collect表示を再計算する。
- 失敗時は既存 `refreshQuestState` を使って対象IDと在庫を再照合。常時ポーリング/新たな同期基盤を作らない。
- 旧client/旧edge応答を自動変換しない。API呼出形はそのまま、型とレスポンスを同一candidateで更新する。

## 6. 未リリースの実利用対象に絞った切替手順

### 事実と範囲

`game-state.ts:19` は固定collection `app.aozoraquest.gameState`、`:118-120` のrkeyは本人DIDのhash、`:135-139` のrepoはbootstrap token由来。Originのnamespaceはこのキーに含まれない。同ファイル`:24-32` はdev/prod共有を明記。`wrangler.toml` は `aozoraquest-edge` と `aozoraquest-edge-dev` が別Worker、KVも別だが、同じrepoを認可した場合stateは共通。

`.github/workflows/edge-deploy.yml` はmainのedgeのみ自動配備、dev edgeは型/テストのあと別途手動。web更新だけでedgeが更新されたと思い込まない。今回live token/repo/稼働revisionは取得していない。未リリースであるというユーザー説明が実利用前提の正本であり、「稼働本番だから全員を保護する」という想定は置かない。

### 最小手順（今回は実行しない）

1. 承認された実装を隔離fixtureで検証する。利用する入口を親が指定する（例: 対象devのwebとdev edge）。別環境の配備を自動的に範囲へ含めない。
2. その入口のedgeとwebを**同じ対応candidate**へ更新する。D001の地形/NPC/shared依頼反映は別承認・直前GET/最小差分/CASのまま。今回のmulti化に依頼内容の変更は不要。
3. テストする人はその入口の旧タブを閉じ、新webを再読み込みして利用する。新しいversion拒否APIや全client強制更新機構は不要。旧activeは空になり新版で再受注する旨を伝える。旧done/flagsは残るため、最初からの物語QCが必要なら対象本人の既存resetを別途選ぶ。
4. **同じ保存先/同じテストプレイヤーを、旧edge側と新版側で交互に遊ばない。** 旧edgeのbattleは `state.quest` だけを増やし、acceptは単一questを再生成するため、新しい受注一覧がある状態で旧入口を使うと通常の討伐が反映されない。CASでも意味の差は防げない。これは具体的な非対応組合せであり、全writer停止機構を追加する理由ではない。
5. 実際に複数入口を併用する試験が必要なら、**使う入口だけ**対応版へ揃える承認を先に得る。それができなければ利用を指定入口に限定する。利用しないmain/prodまで保護目的で先行配備しない。
6. 新版の受注→battle→一覧→指定報告→再読込を確認して切替完了とする。孤立QCを配備済みと報告しない。

### 不具合時

ゲーム操作を止めてcandidate修正/旧版へ戻すかは親が判断する。旧版は新配列を理解しないため、新版の進行を旧版で継続できるとは保証しない（今回許容された破壊的切替）。必要なテストプレイヤーの再開始以外に、PDS全体/管理データ/ポイント等を削除しない。旧版用配列→単一枠の逆変換/二重保存/rollback基盤を実装しない。

## 7. 一対一の実装完了チェックリスト

下表は実装前に固定した受入契約。実装後の行別証拠/未達は§11を参照。REDは現行production seamを呼んで下記assertionが落ちること、GREENは同じassertionが通ること。helperの名前確認や件数を成功証拠にしない。独立レビューは親がfresh reviewerを手配。D001証拠を上書きしない。

|ID/要件|production seam|assertion-level RED|minimal GREEN|保持する成功証拠|禁止事項|後続影響 / 独立review|
|---|---|---|---|---|---|---|
|R1 単一権威/破壊的切替|game-state readState/normalizeState/RMW/init|legacy A進捗7 seed→active空、旧quest無し、done/flags/在庫/パワー不変、GET put0；次のmutation保存もquest無しをassert|配列初期値/default、旧property除去だけ|game-state.testのGETと実CAS保存JSON、XP正規化回帰|旧進捗移行、marker、dual保存、他経済値reset禁止|旧active破棄を明示、schema review待ち|
|R2 複数/重複受注|handleQuestAccept/router|A→独立Bで[A,B]、A再送で進捗不変、並行A/Bとも残る、同時Bは1件|ID追加/duplicate no-op/既存受注条件|game-quest.test stateful CAS＋router認証/body検証|上限、A置換、client金額受入禁止|新UI全件対応、implementation review待ち|
|R3 物語依存保持|handleQuestAccept/advanceScenario/World|slimes+tool-care同時OK、herbsはslimes報告前locked、guild報告だけでslimes flag無し、本人報告後解禁|flags不変、単一busy除去|starter-town-tutorial/game-quest＋tutorial E2E|既存3件依存/内容変更禁止|既存内容で縦切り、UX review待ち|
|R4 共通討伐全件進行|applyBattleOutcome→handleTurn|同対象A/B、別対象C、collectDで決着A/B+2、他不変；応答全件；同turn再送で追加なし|配列map、guard保持、full snapshot|battle-reward/battle-resolver、非win/練習不変assert|1件のみ加算、ローカル加算、guard改変禁止|対応edgeが必要、implementation review待ち|
|R5 ID指定1件報告|handleQuestComplete/router|[A達成,B達成]でB指定→Bだけdone/報酬、A数不変；IDなしbad_request/未受注無変更|対象ID参照/filter、既存CAS|game-quest/router保存差分|先頭報告、一括報告、他active削除禁止|UI選択IDへ直結、implementation review待ち|
|R6 在庫/再送安全|handleQuestComplete/RMW|A/B各2・所持2競合→1成功/1不足、消費2/1報酬/敗者active；所持4なら2成功；同ID1報酬；同一素材報酬の消費順もassert|最新在庫再評価/対象消費のみ|game-quest InvalidSwap注入、最終state/応答、報告後残数表示|予約在庫/不足時消費/失敗時報酬禁止|履歴再設計は#709、reward review待ち|
|R7 同NPC複数定義|core validate/set/gameQuestsByNpc、shared load/save|同NPC異ID2件が有効・順序保持、重複IDreject、実loadで全件読める|perNpc禁止撤去、配列index、caller置換|quest-data.test＋管理保存の実validator fixture|新種別/実依頼追加/同梱強制混合禁止|作者が複数定義できる、design review待ち|
|R8 全受注/共有材料表示|game-quest mirror/WorldMenu/World|2件表示、在庫2→0で両collect不足；空snapshotで全消去、欠落turnでは保持；不明IDでも他件操作可能|配列mirror/全件一覧/在庫注記|game-quest/world-menu tests＋320/390/1280 bounds/screenshots|先頭だけ表示/件数切捨て/確保済み文言禁止|新web入口、UX review待ち|
|R9 実ギルド/報告選択|World guild menu/DialogueWindow＋handlers|同NPC・同名・同目的2件fixtureで識別してB選択→POST Bのみ/B報酬のみ；shared空は空；戻る/退出/ラッチ成立|候補ページ/選択ID/既存会話API|opening-story E2Eの本物World/権威CAS/スクショ|guild専用state/ダミー依頼/即全報告禁止|実同梱4件の縦切り優先、UX review待ち|
|R10 直接NPC複数候補/失敗|World NPC/acceptQuest/refreshQuestState|別NPC B受注OK；同NPC2候補は自動報告しない；B timeout後Aだけでも成功扱いしない|候補配列/対象ID照合/既存GET再確認|tutorial E2E＋lost-response fixture|物語削除/他activeで成功扱い禁止|旧1件導線も確認、UX review待ち|
|R11 load/save/reset|state DTO/World初期化/RMW/handleReset|再読込で全active復元、shop/XP等RMW後保持、reset後空/他人不変、本人world cacheから旧quest復活なし|新DTOと空配列初期化、既存reset維持|game-state/battle-resolver/world-server tests|同期基盤/全員reset/管理PDS削除禁止|対応web/edgeを使用、implementation review待ち|
|R12 D001保持と切替|既存World/救護/ギルド/radius8 seams|実slimes+tool-care並行→battle→guild報告→reload後slimes維持；既存救護/境界assert維持|上記最小変更のみ|opening-story/tutorial既存回帰＋指定入口の実受入|初期付与/画像/建物/遭遇/配備権限の拡張禁止|配備は別承認、fresh review待ち|

## 8. 変更予定ファイル・最小実装順

### 必須変更予定（実装前の固定範囲）

- `packages/core/src/quest-data.ts`: NPC配列lookup、validatorの1NPC制限、進捗コメント。`index.ts` はstar exportなら編集不要。
- `apps/edge/src/game-state.ts`: 型/empty/default/旧quest除去。`game-quest.ts`: 配列受注/ID報告/結果型。`battle-reward.ts`: matching全件。`battle-resolver.ts`: 決着DTO/新規state接続。`router.ts` は新DTO返却への追従が必要な場合だけ（新endpoint/protocolなし）。
- `apps/web/src/lib/world-server.ts`, `lib/game-quest.ts`: wire型/配列mirror/表示文。`routes/world.tsx`, `components/world-menu.tsx`: 一覧/選択/失敗再同期。`components/dialogue-window.tsx` は既存APIで足りれば編集しない。
- 追加のenv、wrangler/workflow変更、migrationファイル、互換layerは不要。

### 変更を前提にしない回帰対象

edge `shop.ts`, `xp-claim.ts`, `scenario-progress.ts`, `world-authoring.ts`, `admin-data.ts`, `server-pds.ts`。web `lib/world-state.ts`, `lib/onboarding-reset.ts`, `lib/world-authoring.ts`, `routes/admin-quests.tsx`。core `starter-town-quests.ts`, `starter-town-scenario.ts`, `scenario.ts`。starter-townの内容/報酬の実データ変更は不要。

### 最小の縦切り

1. 唯一の配列型/受注/報告/戦闘/DTOと本物World一覧を一緒に通す。実 `futaba-slimes` ＋ `futaba-tool-care` 受注→討伐→guild指定納品→再読込後のもう一件の保持まで先に成立させる。
2. 同NPC複数候補は隔離定義fixtureで通す（新しい実依頼内容を勝手に追加しない）。共有素材/CAS/失敗再送を確認。
3. 独立設計/実装/UXレビューと必要なCI後、親が実利用する入口の更新とデータ反映を別に承認。現在のDraftを無断で配備しない。

## 9. 検証計画 / 今回の証拠

以下は設計時に固定した検証計画。実施結果は§11。

- core: `pnpm --filter @aozoraquest/core test src/__tests__/quest-data.test.ts src/__tests__/starter-town-quests.test.ts src/__tests__/starter-town-tutorial.test.ts`
- edge: `pnpm --filter @aozoraquest/edge test test/game-state.test.ts test/game-quest.test.ts test/battle-reward.test.ts test/battle-resolver.test.ts test/router.test.ts`（作業中は該当テスト名に絞る）。既存 `test/support/tutorial-env.ts` / stateful CAS PDSを再利用。
- web: `pnpm --filter @aozoraquest/web test src/lib/game-quest.test.ts src/components/world-menu.test.tsx src/lib/__tests__/world-server.test.ts`
- 実UI: `pnpm --filter @aozoraquest/web test:e2e e2e/opening-story.spec.ts e2e/tutorial.spec.ts`。本物World/DialogueWindow/handlerと実portrait、320/390/1280幅、一覧スクロール/選択肢到達/戻る/退出まで。旧単一依頼E2Eの成功をmulti完成の代用にしない。
- push前の必須typecheck/build/testはCLAUDE.mdに従う。権威schema/報酬経路の実装PRは同§1.5の設計/実装/UXレビュー対象。今回のfresh設計reviewは親が手配。
- 今回実施: handoff/CLAUDE/workflow/D001とproduction/tests/配備構成のread-only調査、git branch/HEAD/status、GitHub Issue/PR読取、docs作成、Issue更新。production編集/テスト追加/全suite/PDSアクセス/merge/deploy/reset/stageなし。開始時の `apps/web/test-results/` を保持。

## 10. 残る判断・制約

- 最小設計は独立レビュー/親承認済み。実装のfreshレビューは未完了。旧保存進捗や旧clientの保護を新要件として戻さない。旧activeは失われる旨をユーザー/試験者へ明示する。
- 実装後に使う入口と、そのweb/edge更新の対象/権限。別入口を併用する場合だけ対応版へ揃える。main/prod/PDSの包括承認はない。
- リセットは切替の必須条件ではない。初めからのシナリオQCを行うテストプレイヤーだけ、既存resetを使うか親が判断。
- `questsDone` 200リング: 同梱4件、現行カタログ上限200。200件超の履歴は管理者が長期にIDを入れ替える条件で、複数同時受注が新たに生む問題ではない。live件数は今回未取得。#709へ分離し全期間履歴再設計を混ぜない。今回の同時report/CAS/既存done拒否は必須。
- live状態/実スマホ/共有データ反映後の受入は未確認。設計承認/隔離QCと配備完了を混同しない。

既存部分成果とuntracked証拠を保持して親へ渡す。**後続reviewは必ず先頭の「未リリース・旧状態破壊可・余計な仕組み禁止」を前提とする。**

## 設計レビュー採用記録

親の実装handoffにより設計を採用。独立レビューのP1（ギルドにも直接NPCと同じ同名識別規則）は§3.2/R9へ反映済み。新state/タイトル一意制約は追加しない。Issue #707/#709のリンクをGitHub読取で確認。設計commitをproduction編集より先に保存する。merge/deploy/PDS書込は禁止のまま。

## 11. 実装と隔離QC記録（D-GUILD-002）

設計を先に `a087f26` でcommitし、その後productionへ実装。唯一の `activeQuests` 配列、全matching討伐、選択IDだけのCAS納品、同NPC配列lookup、全受注メニュー、3件ページの明示選択を追加した。新しい依頼定義/上限/移行機構/flag/protocol/放棄/履歴機構なし。旧quest進捗は意図的に捨て、管理マップ/画像/経済値は変更しない。

|条項|実装後に保持した証拠|状態/限界|
|---|---|---|
|R1|`game-state.test.ts` legacy progress7→空/旧propertyなし、GET put0、CAS後もdone/flags/materials/power保持、混在は新配列のみ、XP/init境界|GREEN|
|R2|`game-quest.test.ts` A/B並行受注、同ID並行1件、再送は前提素材消失後もno-op/progress保持。`router.test.ts`署名JWTで別lxm拒否/ID欠落拒否|GREEN。旧実装で並行受注全成功assertionがfalseになるREDを保存|
|R3|実同梱slimes/tool-care並行→guild報告後もslimes進捗/locked herbs維持、slimes本人報告でflags。既存tutorial E2E連鎖|GREEN|
|R4|`battle-reward.test.ts` matching2件+別敵+collect+unknown、win2頭/非win/練習。`battle-resolver.test.ts`実turn全snapshot/同turn再送409・不変|GREEN|
|R5|BのみcompleteでA進捗保持、Bだけdone/reward。routerはID省略400。実Worldで選択BだけPOSTをguild/direct両方検証|GREEN|
|R6|在庫2/4の同素材2件並行CAS、同ID二重報酬防止、不足不変、同素材rewardは消費後加算。実Worldで報告後Aが0/2表示|GREEN|
|R7|core validator/indexで同NPC同名を順序保持・重複ID拒否。`world-authoring.test.ts`実save/load validatorに同NPC2件。World shared fixture4件/空override|GREEN|
|R8|client full/empty/missing snapshot、全行・報告先・unknown・全collect再計算。WorldMenu全件/共有品説明/閉じる。実World320/390/1280 map bounds|GREEN。受注一覧だけscroll、コマンド2列で小画面の出口を保持|
|R9|opening-story実World/DialogueWindow/権威CASに同名同目的4件fixture、B選択→Bだけ報告/報酬、前/次/戻る/退出。実許可portrait|GREEN。320/390で各buttonをscrollして到達/bounds確認。fixtureはlive依頼ではない|
|R10|直接NPC1件は既存導線、複数は自動報告なし。B受注通信失敗時Aだけでも成功扱いせず、再取得/会話内エラー/再試行でBを受注。§3.4のB報告応答待ち中もbackdrop保持・自分タップでコマンドなし、応答後Bだけ完了/A保持|GREEN。受注失敗表示の修正に加え、fresh review P1の報告中入力遮断をassertion RED→既存Promise返却だけでGREEN（下記）|
|R11|readState/RMW配列保持、migrateInitState空、DTO呼出/実World reload復元。既存reset/delete/shop/XPのfull edge regression|GREEN。既存resetの責務は変更なし|
|R12|実slimes+tool-care並行受注→権威battle処理→guild報告→reload後slimes進捗3保持→本人報告。救護/表情/扉/ラッチ/共有portrait/物語の既存E2E継続|隔離GREEN。live/実スマホ/配備後受入は未実施|

証拠はrepo外 `~/.pi/guild-d002-evidence/`。`assertion-red.log`はR2の旧実装assertion RED、`authority-red.log`は旧validator/quest_busyの失敗、成功証拠ではない。他行は上表のGREEN/既存回帰で確認しており、各行個別のpre-change REDを全て取得したとは主張しない。fresh reviewerの行別判定は親が実施する。

- edge全体296 tests成功、その後router boundary追加1件+resolver初期配列assertionのfocused45成功。web全体448成功、その後DTO8/authoring10 focused成功。core focused18成功（全体はPR CIで確認）。typecheck web/edge、build、validate:data（エラー/警告0）、lint（エラー0、警告25）成功。新warning1件はWorldの会話関数がmove callback dependencyとして毎render更新される点で、動作失敗ではない。
- E2E tutorial成功、opening-storyの新parallel/selected-ID/lost-responseケースを含め成功（37.1s）。`screenshots/`に320/390/1280実画像とmap内証拠。初回E2Eの通信失敗表示assertionは背後notice非表示を検出し修正。DTOテスト初回はGETにbodyがあるとしたfixture誤り、authoring初回はNPCレコードを渡さないfixture誤りを修正し各GREEN。失敗を成功の代用にしない。
- 既存untracked `apps/web/test-results/` は削除せず、開始時コピーもrepo外に保持。Playwright出力先をrepo外へ分離。画像原本・shared PDS未変更。
- PR #708へpushして必須web CIを確認する。edge-deploy workflowはfeature PRでは走らないためlocal edge typecheck/full testを証拠とする（無断dispatch/配備なし）。
- **残るゲート**: fresh独立レビュー、最新CI、対象dev web/edge同版更新の別承認、D001共有データの直前GET/最小差分/CAS承認、実利用/実スマホ受入。main/prod/merge/deploy/共有PDS書込なし。旧タブを閉じ指定入口だけで新版を試し、旧単一進捗は再受注になる。#709履歴再設計は対象外のまま。

### Fresh review P1 — 直接NPCの報告応答待ち（§3.4 / R10）

- `c751577`への独立実装レビューで、`selectDirectQuest` が `void reportQuest(...)` として既存Promiseを捨て、DialogueWindowが応答前に終了するP1を確認。今回のproduction修正はそのPromiseを`return`する1行のみ。新state/frameworkやguild分岐の変更なし。
- 先に既存`opening-story.spec.ts`の直接NPC selected-B経路を拡張。実handlerの応答を明示gateで保留し、backdropが残ること、自分タップ後もコマンドが開かずbackdropが残ること、解放後はBだけPOST/完了しAが受注中で残ることをassert。
- **修正前RED**: backdropが見つからず、背後のコマンドdialogが期待0に対し1。**修正後GREEN**: 同じE2Eが1 passed（test 38.0s / total 40.5s）。既存guild/直接NPC/退出のassertionも同じテストで保持。隔離fixtureの証拠でありlive/実スマホ受入ではない。
- repo外証拠: `~/.pi/guild-d002-pending-fix-evidence/{assertion-red.log,assertion-green.log,red-results/,green-results/,green-screenshots/}`。既存untracked `apps/web/test-results/` は変更/削除しない。
- web typecheck成功、関連DialogueWindow/game-quest unit 16成功。build初回は必須`VITE_APP_URL`未指定で失敗し、明示したloopback URL/NSID/local設定で再実行成功（`build.log` / `build-green.log`）。無関係な全suite再実行なし。旧headのCI成功を新headの成功として流用しない。新headのCI結果は同証拠directoryへ別途保存し、fresh reviewerへ渡す。
- fresh reviewer/新head CIおよび既存の配備・共有データ・実受入ゲートは未完了のまま。merge/deploy/共有PDS書込/resetなし。
