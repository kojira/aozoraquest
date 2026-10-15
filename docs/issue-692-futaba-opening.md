# #692 ふたばの村の導入を旅立ちまで物語でつなぐ

## 承認と範囲
Issue #692 の承認済み物語（放浪者・Blueskyちゃん・七羽の伝承）を、同梱データと初回オンボーディングの文言だけで実装する。
範囲外: spawn・edge・GameState・保存schemaの変更、魔王イービル・マスク、赤い鳥SNSクエスト本体、実PDSへの書込み、main/本番、配備。

## 体験（入口→旅立ち）
1. 初回ワールド入場（localStorage `aq-world-onboarding-done` 未設定）で、話者なしの地の文2窓
   「……きがつくと、しらない 村の まえに たおれていた。」「そらは はいいろ。ここは どこだろう……」
   → 既存のブルスコン操作説明2窓 → 村へ入り井戸のむらおさへ向かう案内1窓。宿屋で目覚める設定は使わない。
2. 村の中: やどやの おかみ が最初に「村の まえで たおれていたのは あんたかい？ よそから きた たびびとだね」。
   むらおさ は「どこから きたんじゃ？」と出自を示唆するだけで解明しない。
3. 井戸のそばに Blueskyちゃん（標準の絵 `bluesky`）。「おにいちゃんが、いなくなっちゃったの。そしたら、空の色も……」。兄の正体は示さない。
4. むらおさの最初の依頼（futaba-slimes）の冒頭に七羽の鳥の伝承と「まずは 村を たすけて 旅の力を つけておくれ」。
   既存の スライム→やくそう→翼膜 の3依頼（flag `futaba_slimes_done`→`futaba_herbs_done`→`futaba_wings_done`）は順序・報酬・条件を変えず、依頼文と完了文で「村を助けて旅の力をつける」流れとしてつなぐ。
5. `futaba_wings_done` 後、Blueskyちゃんが「砂漠の方で、夜になると赤い光が見えるんだって」と、南東・とんぼの原のむこうの ほむらの街 を示す（altLinesなので既に3依頼を終えた既存プレイヤーにも出る）。

## 実装
- web `ONBOARDING_LINES`（`apps/web/src/routes/world.tsx`）に地の文2行を先頭追加、最終行を村への案内へ。既存 DialogueWindow は speaker 省略で名前プレートなし（地の文）を既にサポート。
- core `starterTownNpcs()` に `futaba-bluesky`（Blueskyちゃん, spritePreset `bluesky`, 井戸(15-16,20)の右下 (17,21) の広場石畳）を追加。
  道 y=11/y=17・施設・入口(15,28)・外周・他NPCと重ならない。既存の配置テスト（歩行可/施設なし/端でない/重複なし/隣から話せる/道の到達性）で固定。
- おかみ・むらおさの既定セリフに上記の一言を足す（1窓120字・3窓以内の既存制約内）。
- core `starterTownQuests()` の futaba-slimes intro 先頭に伝承、各依頼の intro/done に「旅の力」のつなぎ文。quest id・npcId・objective・reward・requireFlags、シナリオは不変。
- 同梱村人数のテスト上限を 5→6 に（新NPC追加による最小更新）。
- 既存E2Eの前提更新: tutorial は5窓のオンボーディング、admin-npc-placement は同梱 Blueskyちゃんと合わせて bluesky 絵が2人・オンボーディングを閉じるクリック上限 8→12・標準の絵グループ内のボタンを指定。

## 反映手順（stagingは主管理者PDSが優先）
同梱データを変えるだけでは staging に出ない。管理者が次の順で入れて明示保存する:
1. `/admin/npcs`「ふたばの村の村人を入れる」→ 置換確認 → 保存
2. `/admin/quests`「ふたばの村のクエストを入れる」→ 置換確認 → 保存
3. `/admin/scenario`「ふたばの村のシナリオを入れる」→ 保存（シナリオ定義は変更なし。未投入環境のみ必要）
web の ① はコード配備で反映。既存プレイヤーはオンボーディング既読なので ① は出ない。
管理ダッシュボードの「⟲ あおぞらワールドを はじめから」でリセットすると再生できる（dev・管理者のみ）。

## 検証
- core: 村人の配置/人数/セリフ長、Blueskyちゃんの既定/`futaba_wings_done` セリフ、futaba-slimes intro 冒頭の伝承、3依頼の連鎖（既存テスト）。
- edge: 既存 game-quest の futaba 連鎖テストがそのまま通ること（edgeコード変更なし）。
- web E2E（隔離PDS/API fixture、実Worldを390pxで操作）: ① 地の文→操作説明→案内 → Blueskyちゃんの会話 → むらおさの依頼に伝承 → 3依頼完了後に Blueskyちゃんの旅立ち案内。スクリーンショットは repo 外 `pi-work/assets/aozora-opening-692/`。
- 実devログイン・実PDS投入・実機は未実施（本PRはPRまで）。
