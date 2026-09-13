# #665 ふたばの村: 投稿から冒険につながる導入

状態: **設計独立レビューOK・ローカル実装/検証中**。Refs #658, #659, #665。
基準: `f7a6132`（#664反映後のdev）。正本はこの専用ブランチのMarkdown。

## 1. 復旧と今回の境界

前担当が作成したIssue #665と `docs/futaba-tutorial-experience` / `/Users/kojira/develop/aozoraquest-tutorial-design` を継承する。前担当のログには調査と判断の記録があるが、正本Markdownの書込みはなく、開始時のworktreeはcleanだった。本書はその判断を回収した最初の保存版であり、完成済み設計を発見したとは扱わない。

ユーザーの依頼は「チュートリアル的なシナリオ体験をしっかり作り込む」「開発を続けて」。別案件の「テスト禁止」は適用しない。以下の既存クエスト・確認・進捗・会話・データ作成範囲をレビュー後にローカル実装へ進める。設計だけで再び一般的な承認待ちには戻らない。stagingの実PDS投入は別gate（§8）。

### 作る体験

村に入る → 井戸のむらおさに話す → 依頼を選んで受ける → 村の近くで戦う → 報告して素材とパワーを受け取る → なんでも屋で装備を作り、そうびする → 村人の次の依頼や次の街へ。

主役は「普段のBlueskyへの投稿が冒険のパワーになる」こと。ジョブや戦闘の一般論を説明する長い講義にはしない。1会話は2〜3窓を基本とし、1窓120文字以内、かな多め。常設の新しいチュートリアルパネル、地面の矢印、強制移動、投稿の強制・自動作成は加えない。

### 実装に含めないもの

- 新しいチュートリアルエンジン、GameState schema・collection・rkey変更、移行、reset。
- 無料練習戦、開始資源の付与、戦闘/宿/制作コスト・ドロップ率・XP調整。
- 「投稿なし・power 0でも5分で完走」の保証。遭遇と素材はランダムで、5分は保証値にしない。
- 管理データの全面env分離、SERVER_DID変更、本番操作、staging管理レコード書込み。
- クエスト破棄、複数同時受注、制作完了を新規クエスト条件にすること。

## 2. 現行実装で成立すること

- `GameQuestDef` は `defeat` / `collect`、1 NPC 1依頼、`requireFlags`、固定報酬powerと1種の素材を持てる。
- `handleQuestAccept` は `quest_busy` / `locked` / `already_done` を検証。同じ依頼の受注再送はno-op。
- `handleQuestComplete` は権威stateの討伐数/素材を検証し、collectの必要個数を差し引き、報酬・達成済み・flagsを同じCAS更新で確定する。付与経路自体は変更しない。
- `advanceScenario` は戦闘決着・報告時に発火する。移動/会話/制作だけでは発火しない。**初回の無条件イベントで受注を解禁すると初戦前に詰まるので採用しない**。
- NPCの `altLines` は上から最初に条件一致した会話を返す。未完了の解禁済み依頼の会話は通常会話より優先される。
- power 0の戦闘は報酬/討伐進捗が付かない。移動・会話は無料。宿は有料で、街に入るだけでは回復しない。
- `ar-cloth`（ぬののふく）は全ジョブ装備可能、既定制作コストpower 4 + 店の素材1。店の自動生成だけではこの品と素材種類は固定できないため、下記の既存ShopOverride形式でローカル検証用の導入品揃えを明示する。
- 管理レコードを読めない時にチュートリアルデータへ自動fallbackする既定動作は追加しない。

## 3. コンテンツ定義（今回の固定値）

`packages/core/src/starter-town-quests.ts` に `starterTownQuests()` を置く。既存NPC ID/座標は変更しない。#658の例を採用した3本、順序は以下。rewardは既存 `GameQuestDef.reward` のデータのみ。新しい資源付与APIは作らない。

| id / title | NPC | 条件 | 解禁 | 報酬 | 意味 |
|---|---|---|---|---|---|
| `futaba-slimes` / スライムから 村をまもろう | `futaba-elder` | defeat `sky-slime` ×3 | なし | power 4 + `slime-drop` ×1 | 受注・戦闘・報告・制作への入口 |
| `futaba-herbs` / やどやの やくそう | `futaba-innkeeper-wife` | collect `herb` ×3 | `futaba_slimes_done` | power 3 + `herb` ×1 | 所持品確認・渡す・宿の役割 |
| `futaba-wings` / たびじたくの おてつだい | `futaba-shopfront` | collect `bat-wing` ×2 | `futaba_herbs_done` | power 4 + `slime-drop` ×1 | 制作の再案内・村から先へ |

collectは受注前の所持品も数える。報告で指定個数を渡すことをintroに明記。herbは3つ渡して1つ返る（治療用に残せる）。報酬は一度限りで、repeatable設定や日次resetなし。報酬を使ってから再び不足した場合も追加救済をしない。

### セリフ

`intro` / `progress` / `done` は次を固定文言として実装する。APIや試験ラベルはプレイヤーに見せない。

**むらおさ**
- intro: 「村の そとの そらいろスライムを 3たい たおしてくれんか。」「すんだら わしに はなしかけておくれ。たびじたくの おれいを わたそう。」
- progress: 「そらいろスライムを 3たいじゃ。むりせず 村の ちかくで な。」「じぶんを おして メニューを ひらくと、あと どれだけか わかるぞ。」
- done: 「ありがとう。これで 村の みんなも あんしんじゃ。」「おれいの パワーと しずくで、なんでも屋の『ぬののふく』を つくれるぞ。」「つくったら『そうび』で みにつけておくれ。やどやの おかみも こまっておったな。」

**やどやのおかみ**
- intro: 「やくそうを 3つ わけてくれないかい。」「3つ そろったら わたしに はなしかけてね。うけとったら おれいを するよ。」
- progress: 「やくそうは『どうぐ』で たしかめられるよ。つかったぶんは また あつめてね。」
- done: 「たすかったよ。やくそうを 3つ うけとったよ。」「ひとつは あなたの たびに もっていきな。つかれたら やどやへ おいで。」「つぎは なんでも屋の むすめに はなしかけてみてね。」

**なんでも屋のむすめ**
- intro: 「コウモリの翼膜を 2つ あつめて わたしてくれない？」「村の そとの コウモリが おとすよ。そろったら わたしの ところへ もどってね。」
- progress: 「翼膜は『もちもの』で かくにんできるよ。2つ そろったら もってきてね。」
- done: 「ありがとう！ これで たびじたくが すすむよ。」「パワーと しずくは あなたの そうびづくりに つかってね。」「じゅんびが できたら、おじいさんに つぎの街の はなしを きいてみて。」

### シナリオ

既存 `SAMPLE_SCENARIO` / `ch1_start` などは書き換えない。別の `starterTownScenario()`（新 `starter-town-scenario.ts`）を作る。各イベントのwhenは該当 `questDone` のみ。

| event id | when.questId | setFlags | notice |
|---|---|---|---|
| `futaba-after-slimes` | `futaba-slimes` | `futaba_slimes_done` | なし（報告会話で案内し重複窓を出さない） |
| `futaba-after-herbs` | `futaba-herbs` | `futaba_herbs_done` | なし |
| `futaba-after-wings` | `futaba-wings` | `futaba_wings_done` | なし |

最終flagは「3本の依頼を報告済み」であり、「装備を作った/チュートリアル全操作完了」を意味しない。制作は既存店/そうび画面で実操作し、シナリオが実施済みと推定することはしない。次の街を新しくロックしない。

### NPCの案内差分と初回

- 既存 `ONBOARDING_LINES` を3窓へ短縮: 「ようこそ あおぞらワールドへ！ マップを おしたまま ゆびを うごかすと あるけるよ。」「じぶんを ちょんと おすと コマンドが ひらくよ。村人に ぶつかると はなせるんだ。」「まずは 村の いどのそばの むらおさに はなしかけてみよう。」既存初回キーを維持し、強制再表示しない。
- 入口のこども: 「Blueskyへの とうこうが あおぞらパワーに なるんだ。あるいたり はなしたりするだけなら へらないよ。」「パワーが ないと、たたかっても おれいや たのまれごとは すすまないよ。とうこうしたくなったら、いつもの がめんへ もどってね。」「村の いどのそばに むらおさが いるよ。」投稿ページへの新規強制遷移ボタンなし。通常の投稿UIを本人が選ぶ。
- むらおさは `futaba_slimes_done` で「なんでも屋で そうびを つくり、そうびで みにつけるのじゃ。やどやの おかみの はなしも きいておくれ。」に分岐。`futaba_wings_done` 分岐を先頭に置き「村を たすけてくれて ありがとう。これからは じぶんの ペースで たびを つづけるのじゃ。」。
- おかみの通常会話は宿代を既存 `STARTER_TOWN_INN.price` から組み立てる。街に入るだけでは回復しないこと、敗北で最後の街へ戻り素材を少し失うことを2〜3窓で伝える。完了後も宿の案内を残す。
- むすめは依頼解禁前の通常会話を制作→そうびの案内にする。既に作った人にも作り直しを要求しない。
- おじいさんは通常「街に つくと まわりの ちずが ひろがる。村の そとで ちずを ひらいてみると よい。」、`futaba_wings_done` 後は「じゅんびが できたら つぎの街を さがしてみるのじゃ。とうこうしたくなったら ひとやすみも よいぞ。」。地図ボタンは内部で出ないため『いつでも』とは言わない。

### 制作が実際にできる品揃え

既存 `ShopOverride` 形式で、ローカル導入データにふたばの村の外部座標（`starterTownInterior` の元のtown、内部店タイル座標ではない）を使い、`ar-cloth` / `slime-drop` を含める。品揃えを消去せず既存の生成結果/上書きのequipmentへ `ar-cloth` を重複なし追加する。素材種類を `slime-drop` にする操作は明示的な導入設定であり、全街の価格計算や生成規則を変えない。既存shop生成の値と統合する純粋な同梱ヘルパーを `starter-town-quests.ts` とは分けて置き、管理画面の自動保存はしない。

第1依頼の報告直後に別用途へ使っていなければ、報酬だけで全職共通のぬののふくを1回作れる。制作前に宿/他装備へ使った場合は不足表示と投稿・素材収集で再開。無料作成・配布・価格overrideはしない。

## 4. 受注確認・進捗・通信（#659再利用）

既存未保存作業 `/Users/kojira/develop/aozoraquest/.claude/worktrees/agent-aad13cdd1dab2f96f` の11 tracked + 3 untrackedファイルを読取snapshotに保存した。元worktreeをreset/commit/削除しない。実装担当は専用feature worktreeへdiffと新ファイルを移植し、#664到着通知差分を残して競合を解く。旧branch丸ごとのmergeはしない。

- intro最終窓「うけますか？」で `はい / いいえ`。本文送り/連打/キー押しっぱなしでは受注しない。タイプ中タップは全文表示だけ。いいえ/閉じるはAPI 0回、次に話すと再提示。
- はいでのみ既存 `POST /api/quest/accept {questId}`。送信中は同じ選択・移動・NPCバンプを塞ぐ。成功応答後に閉じて「『題名』を うけおった！」。失敗は受注済みと表示しない。通信結果不明なら `/api/me/state` の現行取得で同期して再試行可能にする。
- 持っているのはサーバーstateの写し。`quest` と `questsDone` を `/me/state`・受注/達成から同期。戦闘結果の `quest?: {id,progress}` 追加は後方互換。応答にないだけでactiveを消さない。state/refの更新は同じsetterで同期し、直後のバンプが古いactiveを読まない。
- メニューへ題名と進捗1行。defeatは権威progress、collectは現在materialsから計算し、消費/敗北で減れば表示も減る。単位は「たい」「こ」。達成可能なら同じ1行に「村人に はなそう」、別HUDは作らない。
- 報告は既存NPCバンプ→complete。通信中移動を塞ぐ既存処理を維持。成功後だけdone会話/報酬通知。`not_ready` はprogress会話と不足、他のエラーは通信失敗として出す。
- `already_done` / `not_accepted` / `quest_busy` の競合時はstateを再取得し、最新のactiveを保持する。他タブで受けた別依頼を勝手に消さない。報酬再送や自動complete loopなし。

## 5. 中断・敗北・再訪

| 操作/状態 | 結果 |
|---|---|
| 初回・0power | 無料で村を歩く/依頼を聞く/受注も可能。入口の会話と既存0power警告が報酬/進捗なしを説明。投稿は本人が任意で既存UIから行う。休止も可 |
| 任意投稿後に戻る | world再入場で既存server stateを再取得。投稿を検出して新たにpower加算するコードは書かない。反映前なら残高0のまま案内し架空の加算をしない |
| いいえ・画面離脱 | 断るだけではquest/flags/資源変更なし |
| 途中で閉じる・後日復帰 | サーバーからactive/flags/materialsを読んで続行。初回会話を毎回長く出さない。依頼主とメニューで目標を再確認 |
| 敗北/逃走 | 既存ルールのまま。討伐数をclientで増やさない。敗北で素材が減るならcollect進捗も減る。無料回復/補填はしない |
| 必要素材を先に所持 | collect受注後に報告可。未受注で勝手に引き取らない |
| 二重達成・リロード | CASとquestsDoneで一度だけ報酬。UI成功推測で加算しない。既存MAX_DONE=200問題は本3件の導入で改修しない |
| 完了済NPC再訪 | 新規受注/報酬なし。flagに沿った短い会話 |
| 制作前に報酬消費 | コスト不足を既存店が表示。任意投稿/素材収集で再開。詰みと称して新規付与しない |
| 制作済み・全3依頼報告後 | 装備の強制再作成なし。次の街/投稿/休止を自分で選べる。制作完了flagなし |

## 6. 変更ファイルと投入入口

ローカル実装対象は次のみ（必要な既存テスト更新を含む）。

- core: 新 `starter-town-quests.ts` / `starter-town-scenario.ts` / 導入shopヘルパー、`interior-samples.ts` の会話、`index.ts` export、既存 `quest-data.ts` の進捗整形（#659）。
- web: #659の `dialogue-window` / `world-menu` / `lib/dialogue` / 新 `lib/game-quest` / `world-server` / `routes/world`。初回会話と受注同期を上記に限定。
- web `routes/admin-quests.tsx`: #658の「ふたばの村のクエストを入れる」。同ID置換、無関係ID維持、確認あり、保存までローカルdraftのみ。村人未読込/未保存/参照不一致なら案内して止める。
- web `routes/admin-scenario.tsx`: 「ふたばの村のシナリオを入れる」。既存サンプルと別ボタン。先に3クエストの保存が必要。IDで置換し既存非対象eventを残し検証。保存は明示操作のみ。
- edge: #659の戦闘結果へのquest写しとテストのみ。game-quest / scenario-progress / readModifyWrite / battle-rewardの報酬ロジックは変更しない。
- NPCは既存admin-npcsの同梱追加、shopは既存admin-shopsの明示編集を使える。同梱shopヘルパーはローカル試験で同じ設定を再現する用途。新しい一括投入APIは作らない。

投入順: 内部マップ/ゲート → NPC → quests → scenario → shop。各段階の既存validatorで参照を検査する。ローカルは既存settersとテストのin-memory PDS boundaryを使い、実ネットワークを禁止。管理者PDSへの自動bootstrapなし。

## 7. 検証・受入

設計段階ではアプリテストは未実施。**実装段階では必要テストを実施する**。

1. core: 3questのunique ID・NPC/monster/item参照・台詞上限・報酬定義、setGameQuests→setScenario成功、未達→順次flag→次の解禁、再評価no-op。旧sampleと共存できる。
2. UI: 本物のDialogueWindowで全文送り→はい/いいえ、いいえAPIなし、二重クリック/送信中移動なし、失敗から再開。WorldMenuが戦闘/素材変化/再入場で更新。#659既存テストを移植し重複しない。
3. edge: 本物のaccept/complete/battle reward resolver + 隔離PDS境界。0power進捗0、3勝→報告、未達collect拒否、素材差引、報酬1回、並行達成、stage flag順序。報酬経路は既存コードを通す。
4. 制作: 導入shopと実shop resolverで第1報告直後のpower/materialsからar-cloth作成→既存equipに反映可能。任意の既存ジョブ（clothは全職可）で検証。API本体で在庫/コストが変わったことを確かめる。
5. ローカルブラウザ: 本物のWorld/村/NPC/店コンポーネント、同梱データ、本物のレスポンスschemaで1周。PDS境界だけ隔離し外部への副作用なし。0power/断る/途中復帰/敗北を重点確認する。これは試験であり、ユーザー向けにmock画面を納品しない。
6. push前にはCLAUDE.md必須typecheck/build/test、重要UI変更のe2eを満たす。報酬データを含むため付与経路/不正二重付与を独立レビューで確認し、CLAUDE.md §1.5の適用を親が判定する。

受入は単なるテスト件数ではなく、入口から次の行動が分かり、断る/休止もでき、報告後に実際に制作・装備まで触れること。staging実機受入は§8完了後であり、ローカル成功と混同しない。

## 8. staging投入は別判定（本実装を止めない）

確認済み事実:
- web `ADMIN_COL.world*` は環境共有prefix、world-authoringのrkeyは `self`。
- edge `index.ts` と `router.ts` はworld loaderへのnsid導出が異なり得る。loaderのcacheはnsidごとでない。
- `GAME_STATE_COLLECTION` は固定、rkeyはtarget DID hash。**同じサーバーrepoを使用していれば**devからも同じstateへ書く。コメントは共有と書くが、現稼働のSERVER_DID/token repo一致は未確認。
- docs22はWorker/KV/secrets分離を定めるが、SERVER_DID同一を許容しており、実PDSレコードの分離証明にはならない。

したがって、このブランチでは全authoring rkey変更やGameState分離を実装しない。stagingの新データ投入・実アカウント試験も保留。既存#664の配備承認を本件の共有管理データ上書き承認に流用しない。

実データ投入の再開条件（親が別タスクで必要最小限を判断）:
1. 秘密値を表示せずdevの実読書きrepo/collection/rkeyと本番が交差しない証跡を確認する。
2. 既に独立dev SERVER_DID/管理者repoがあり全loaderで一貫しているなら既存経路を優先。なければ限定された分離案を別設計/PRにし、self-devやd+hashを唯一の決定済み方式としない。
3. 対象dev管理レコードとテストstateのみの明示投入承認。元レコードとCIDを退避、投入直前のCID一致を確認。失敗したら体験入口を公開せず投入済み範囲を記録し、続行/復元を判断する。
4. rollbackは対象IDだけを削除する乱暴な方式でなく、承認された退避record/CIDを使う。別編集があれば停止。進行中/達成済state・報酬を自動巻戻し/再付与しない。参照先データを消してactive questを孤児化しない。

ローカル試験データの初期化/破棄は隔離fixtureのみ。実ユーザーを「最初から」にresetしない。

## 9. 引き継ぎ

次は本書の独立レビュー→#659未保存差分を専用feature worktreeへ移植→#658/本書の3依頼と会話/シナリオを実装→ローカル一周検証。ここで再び長いenv全監査へ戻らない。設計レビューで上記の既存仕組みに収まらない事実が出た場合だけ、その箇所を停止し親へ判断を求める。


## 10. 実装時の局所整合修正

- `useAuthoredWorld` は失敗でもloadedをtrueにし、既存の保存関数はput成功前にglobal定義を変更していた。§4/§6の「保存までdraft・未読込なら保存不可」を満たさないため、親の局所修正許可に従い、クエスト/シナリオの2画面のみ保存済NPC→内部マップ→quests→scenarioをstrictに読む。RecordNotFoundだけは空、通信/認証失敗は保存不可。pure validatorを既存setterから抽出し、両保存関数は検証→put→setterへ。schema/権限/fallbackは追加しない。put失敗と読込失敗、無関係ID保持を回帰試験する。
- 実Worldのブラウザ復帰試験で、並行authoringロードより先に村内stateを描画すると、内部座標がフィールド扱いになりNPCへ話せないことを再現。初期state読込はauthoring完了後に直列化。既存readerの失敗時fallbackそのものは変更しない。成功した村内再入場でNPC会話・進捗表示へ戻る試験を追加した。
- 0powerの既存欄に依頼も進まないことを明記し、古い「街に入ると全回復」を有料の宿へ訂正。追加の無料付与や強制投稿なし。
- `#659`未保存原本は変更せず、14ファイルをsnapshotからfeatureブランチへ移植した。#664の到着通知/地図処理を維持。

### 検証上の境界

ブラウザ試験は本物のWorld/DialogueWindow/WorldMenu/ShopModal/GearModalを描画し、受注/報告/制作/装備は本物のedge handlerと隔離CAS PDSを通す。0power・いいえ・送信中・再入場・3報告・実制作/装備を確認する。戦闘の3勝と素材収集には隔離fixture checkpointを使い（本物のbattle rewardを適用）、無作為遭遇を含む全行程の連続プレイやスマホ実機/staging受入を完了したとは扱わない。これらのfixtureはe2e専用entryで通常buildには含まれず、ユーザー向けUIではない。実管理PDS/実ユーザーstateの変更なし。

### 実装検証結果

- core 823 / edge 270 / web 427 tests成功、各typecheck成功。web lintはerror 0（既存を含むwarning 24）。validate:data エラー/警告0、web build成功（既存の大チャンクwarningあり）。
- Chromium・390pxの本物のWorldで、初回会話→いいえ→再受注（送信中の移動抑止）→3勝checkpointから再入場→メニューの報告案内→報告→実制作→実そうび→残り2依頼の受注/報告を実操作。PDSは隔離、権威handlerは本物。関連e2e＋既存未ログインsmoke計5成功。撮影画像はレビューartifactに保存。
- 原本#659の14ファイルSHA256は移植前snapshotと同一。元worktree・他branch未編集。
- 初回検証で旧「NPC会話最大2窓」assertionが失敗（承認済の3窓へ更新）。ブラウザ復帰失敗は上記ロード順修正後に成功。その他のテスト作成中の型/selector誤りは修正し、最終suiteのexit code 0を確認。
- 実装の独立レビュー・stagingでの実機/自然遭遇を含む連続プレイ・管理レコード投入は未実施。Draft PRはこれらを完了と主張しない。
