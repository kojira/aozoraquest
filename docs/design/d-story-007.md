# D-STORY-007 — 冒頭の謎/ギフト/転移 + 第1章の引き + 再利用できる演出（設計草案）

基点 origin/dev e51976b（読取のみ）。**設計のみ**。repo変更・PDS書込・merge/deploy なし。台詞は【要承認】付き。
ユーザー決定（Discord）: 転移前の虚空で逆光シルエット「？？？」（兄 Twitter、正体伏せ）がギフトを授け→白い光→既存の Blueskyちゃん救護。あおい はね／ブルスコンは物語に出さない。演出はコードで、シナリオから再利用可能。第1章末に赤い光の引き＋鳥の手紙＋ほむらの街への誘い。第2章は ほむらの街 NPC 1 行のみ。

## 1. 体験（地図枠内。会話窓は既存 anchor="map" の 96%幅×35%高）

### 1a. 冒頭（新規/リセット後の初入場だけ）
1. World 読込直後、地図枠は**最初から真っ黒**（地図は見えない。マウント時点で暗転済み＝フェード無し）。
2. 窓に地の文「……ここは、どこ？」。地図枠上部（会話窓より上の領域）に**逆光シルエット**がふわっと現れる（800ms）。顔・色は一切出ない。
3. 話者プレート「？？？」（会話イラストなし）で【要承認】:
   「やっと とどいた。きみの ことばが。」／「むこうの 空は いま、いろを うしなっている。七羽の 鳥が、ねむってしまったから。」／「ぼくには もう、とぶ ちからが のこっていない。」／「だから、きみに ギフトを わたす。きみの ことばの かたちが、そのまま きみの ちからに なる。」
4. 地の文「【ギフト】ことばの ちから を さずかった！」（付与処理なし。投稿→あおぞらパワーの既存仕組みの物語化。§1c）
5. ？？？「むこうで、きっと……いや、なんでもない。」→「――空を、たのんだよ。」
6. 次の送りで**白い閃光**（700ms）。閃光の裏で暗転とシルエットが消え、地図が現れる。同じ窓のまま既存救護（心配顔「……きこえる？ だいじょうぶ？」→…）へ続く。以降の手渡し・ガイド・祝福は既存どおり。
7. タップ/Enter で常に送れる。演出は送りを待たせない（閃光中に送っても次行へ進む）。移動/コマンド遮断は既存 onboarding ガードのまま。

### 1b. 第1章の引き（futaba-wings 報告時、一人一度）
1. なんでも屋で報告→既存の done 行（話者 なんでも屋の むすめ）。3行目を変更:
   「これで 旅の力は じゅうぶん。いどのそばのギルドの Blueskyちゃんが あなたを さがしてたよ。」
2. 報酬行「… を もらった！」の後、**地の文**で「そらが いっしゅん、あかく ひかった。」と同時に地図が**赤く染まる**（1600ms で引く）。
3. ギルドで「話す」（altLines futaba_wings_done、全行 Blueskyちゃん）【要承認】:
   「みた？ いま 空が あかく ひかったの。」／「それとね、ことりが てがみを はこんできたの。……おにいちゃんの 字だ。」／「『あかい 鳥が めを さましかけている。ほむらの街へ むかってくれ。――空を、たのんだよ。』」／「……ねえ、いっしょに さがしてくれない？ みなみひがしの とんぼの原の むこう、ほむらの街へ。」
   （兄の名は出さない。最後の手紙文がシルエットの台詞と一致＝伏線）
4. 第2章入口: ほむらの街（region 26, 320,448）付近のフィールド NPC 1 人、1 行【要承認】:
   名前「砂漠の 見張り」「ゆうべ、空が あかく ひかったろう？ 砂漠の おくで なにかが めを さましかけてるらしい。」

### 1c. ギフトと +20
- +20（WELCOME_POWER）はリセット経路だけの既存付与。付与量・経路・タイミング・祝福演出は**変更しない**。
- 冒頭のギフト行は全員に出す（数値なし）。リセット祝福時の手渡し末尾の行だけ文言を「【ギフト】ことばの ちから で あおぞらパワーが 20 ふえた！」に変える案【要判断 D2】。

## 2. 演出モデル（最小）

```ts
// packages/core/src/story-effect.ts（web/edge/admin 共通の型と検証）
export type StoryEffect =
  | { kind: 'fade'; to: 'black' | 'clear' }      // 持続: 地図枠を黒で覆う/戻す (600ms)
  | { kind: 'silhouette'; show: boolean }         // 持続: 兄シルエット (同梱 1 枚のみ)
  | { kind: 'flash'; color: 'white' | 'red' }     // 一過性: 強い全面パルス 700ms
  | { kind: 'tint'; color: 'red' };               // 一過性: 半透明の色かぶり 1600ms
```
- 色・種類は閉じた列挙（任意色/任意画像は不可）。シルエット画像は同梱の1枚に固定（後の章で増やすときに引数を足す）。
- **行単位キュー**: `DialogueLine.effects?: StoryEffect[]`。その行が表示された瞬間に適用。
- **持続状態は純関数で導出**: `storyEffectState(lines, index)` = 行0..index の fade/silhouette を畳み込んだ結果。窓（またはその段 conversationStep）が閉じれば消える＝**演出は会話の外へ漏れない**（黒画面が残る事故なし）。初期行の状態はマウント時から適用（遷移なし）。
- 一過性（flash/tint）は `(step, index)` をキーに 1 回だけ再生。行送りで止めない・待たない。
- 描画: DialogueWindow が anchor="map" のときだけ `StoryEffectLayer` を地図枠内（position:absolute inset:0）に出す。z は送り面(900)と窓(901)の間、pointer-events:none。viewport 窓では無視。
- シルエット描画: 黒塗り webp を地図枠の上部領域（会話窓の上、既存 portrait 領域と同じ範囲）に contain。背面に radial-gradient の逆光、本体に `drop-shadow(0 0 2px #dfe8ff) drop-shadow(0 0 14px rgba(160,190,255,.7))` で縁光（preview と同等）。
- reduced-motion: fade/silhouette は即時切替。**flash/tint は再生しない**（光過敏配慮。文言が意味を担う）。
- 会話イラスト: 冒頭の窓は window portrait を渡さず、救護行4〜6に ONBOARDING_PORTRAIT を行指定する（？？？行に Blueskyちゃんの絵が出ないため。新しい仕組みは足さない）。

## 3. 発火経路
1. **冒頭**: `world-opening.ts` に `PROLOGUE_LINES`（効果付き）を追加し、onboarding 窓の lines を `[...PROLOGUE_LINES, ...既存]` に。救護1行目に `[{fade clear},{silhouette false},{flash white}]`。
2. **シナリオイベント**: `ScenarioEvent.effects?: StoryEffect[]`。そのイベントの notice 行に付く。edge `advanceScenario` が `messages: {text, effects?}[]` を返し、応答に任意 `scenarioMessages` を追加（quest complete / battle turn）。既存 `notices`/`scenarioNotices` は残す（旧 web 互換）。新 web は scenarioMessages を優先。
3. **クエスト報告窓**: 現状 notices は NPC 話者の行として流れる。`NpcTalk.notices?: {text,effects}[]` を追加し world.tsx で**地の文**行として末尾に足す（引きに必要な最小修正）。
4. **戦闘決着**: pendingNoticesRef を `{text,effects}` に変え、既存 scenarioTalk 窓で効果付き表示。
- NPC 台詞（lines/altLines）への効果付与は対象外。

## 4. シルエット素材
- 原本 `~/.pi/story-d007-evidence/brother-original.png` は repo に入れない。
- `scripts/bake-silhouette.py`（Pillow + cwebp、入力パス引数）: α を 128 で二値化→768×512 に縮小→RGB を単色 #0b0f1a で塗る→lossless webp。出力 `apps/web/src/assets/story/brother-silhouette.webp`（import で同梱、hash 付き）。
- 試作実測（repo外 /tmp）: 20,410 B、RGB は単色のみ（原本の色/顔情報ゼロ、輪郭のみ）。原本の α 内部は 250〜253 のノイズのみで顔の情報は無いが、二値化で除去する。
- 公開リポジトリには輪郭のみが入る。輪郭自体の公開可否【要判断 D3】（後の章で正体公開予定なので輪郭は可と想定）。

## 5. 検証上限
- `validateScenario`: effects は配列・最大 4 件・各要素が上の列挙に一致・**notice 必須**（効果だけのイベントは描画先がないため拒否）。
- notice 120 字・NPC 行 120 字は既存上限のまま（今回の文はすべて内）。
- 旧 edge は未知キー effects を無視するだけ（検証で落ちない）。

## 6. 管理画面（最小）
- `/admin/scenario` のお知らせ欄の下に「演出」: プリセット select（暗転する / 暗転を戻す / シルエットを出す / 消す / 白い閃光 / 赤い閃光 / 空が赤く染まる）＋×＋「＋演出」。お知らせが空なら無効。保存は既存 validate。
- 「ふたばの村のシナリオを入れる」の同梱定義（starter-town-scenario.ts）も新 notice/effects に更新。

## 7. 既存プレイヤー
- 冒頭: 既存どおり ONBOARDING_DONE_KEY 未設定の入場だけ（新規・リセット・端末変更）。既見の人には出ない。
- 引き: futaba_wings_done を新たに立てた報告で一度だけ。既に立っている人は発火済み扱い（全 setFlags 既存）で notice/赤光は出ない。
- 手紙 altLines は futaba_wings_done を持つ全員（既存達成者含む）に届く。done[2] の変更は今後の報告者だけが見る。
- 権威 GameState schema・付与・報酬・クエスト連鎖は不変。

## 8. データ変更（dev のみ `app.aozoraquest.dev.world.*`、承認後に別ゲート）
| record | id | 変更 |
|---|---|---|
| scenario | futaba-after-wings | `notice:"そらが いっしゅん、あかく ひかった。"`, `effects:[{kind:'tint',color:'red'}]` 追加（when/setFlags 不変） |
| quests | futaba-wings | done[2] の後半のみ「…あなたを さがしてたよ。」 |
| npcs | futaba-bluesky | altLines[futaba_wings_done].lines を §1b-3 の 4 行に置換 |
| npcs | homura-lookout（新規） | フィールド（mapId 省略）、ほむらの街の隣接で町への経路を塞がない歩行可能マス、spritePreset 'old-man'、lines 1 行 |
- 同梱サンプル（starter-town-quests.ts / interior-samples.ts / starter-town-scenario.ts）も同文に揃える。homura NPC は同梱しない（データのみ）。
- 手順: `admin-data.mjs get` → 提案 JSON を repo外に保存 → `put --dry-run` 差分 → 承認後 put。位置は保存済み dev 地図で validateNpcPlacement を通した座標を提案時に確定。

## 9. 配備順
1. core（型/検証）+ edge（scenarioMessages）を含む PR を dev へ → dev edge 先行配備。
2. 同 PR の web（演出層・冒頭・報告窓・管理画面）を dev web へ。
3. 動作確認後に dev データ反映（§8）。データ先行でも旧コードは effects を無視し notice だけ出る（安全）。
4. 本番はリリース PR で別判断。

## 10. 完了チェックリスト
| 条項 | production seam | assertion RED | minimal GREEN | 保持証拠 |
|---|---|---|---|---|
|効果の型/検証|core `story-effect.ts`, `validateScenario`|`scenario-effects.test.ts`: 未知kind/notice無し/5件を受理してしまう|列挙検証+notice必須|core test log|
|edge 配送|`scenario-progress.ts`, `game-quest.ts`, `battle-resolver.ts`|edge test: 報告応答に scenarioMessages(effects) が無い|messages を返す|edge test log|
|持続状態の導出|web `lib/story-effects.ts`|unit: index2 で fade black/silhouette が導出されない|畳み込み|unit log|
|窓での描画/RM|`DialogueWindow` + `StoryEffectLayer`|`dialogue-window.test.tsx`: 黒層/シルエット img なし、RM で flash 要素あり|層を描画、RM 抑止|unit log|
|冒頭体験|`world-opening.ts`, world.tsx onboarding|E2E opening-story: 初フレームで地図が見える/？？？行に Blueskyちゃん絵|PROLOGUE+行指定portrait|320/390/1280 スクショ、黒画素率|
|転移|同上|E2E: 救護1行目で黒が残る|fade clear+flash|スクショ連番|
|引き|`use-npc-quest-talk.ts`, world.tsx|E2E tutorial: notice が話者付き・赤光なし・done[2]旧文|地の文+tint|スクショ、二度目なし|
|戦闘経路|`use-world-battle.ts`|unit/E2E: 決着由来 notice の効果が落ちる|{text,effects} で保持|log|
|素材|`brother-silhouette.webp`, bake script|検査: RGB が単色でない/原本ファイルが dist にある|二値化単色|bake 出力の検査結果、dist grep|
|管理画面|`admin-scenario.tsx`|E2E: 演出を足して保存しても effects が保存されない|プリセット行|PUT body|
|データ|dev PDS|dry-run 差分が §8 以外を含む|4 件のみ|before/proposed（repo外）|
既存 E2E（opening-story / tutorial / guild-dialogue-steps）の旧文 assertion は該当文のみ更新。独立レビューは実装 PR で実施。

## 11. 対象外
シルエット正体公開・原本の同梱、第2章本編/赤い鳥クエスト、NPC 台詞への効果、任意色/任意画像の演出、BGM/SE、ギフトの新しい付与・数値変更、+20 経路変更、ブルスコン/あおい はね関連、本番データ・本番配備、移動位置トリガー（「街に着いたら」発火）。

## 12. 要判断（ユーザー）
- D1 台詞: 冒頭（supervisor 草案そのまま）、Blueskyちゃん手紙 4 行、ほむら NPC 名と 1 行。
- D2 リセット祝福の手渡し末尾行を「【ギフト】…20 ふえた！」に変えるか（祝福オーバーレイ「はじまりの祝福」表記は据え置き案）。
- D3 輪郭のみの webp を公開 repo に含めてよいか。
- D4 ほむら NPC を条件なし（全員に同じ1行）にするか、futaba_wings_done の時だけにするか（草案は条件なし）。

## 13. ユーザー決定（Discord、確定）
- 逆光シルエット素材: ~/.pi/story-d007-evidence/brother-silhouette.webp（単色+α、768x512、20,430B）を承認「いいね これでいこか」。描画は silhouette-scene.png 相当（放射状の逆光＋白い縁光＋白っぽい halo）をコードで。
- D1 台詞: §1 のとおり承認。D2: 変える（リセット祝福行を「【ギフト】ことばの ちから で あおぞらパワーが 20 ふえた！」）。D3: 輪郭のみ webp を repo に含めてよい。D4: ほむら見張りは条件なし。
- 演出はコード実装・シナリオから再利用可能（ユーザー明示）。
