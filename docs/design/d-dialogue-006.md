# D-DIALOGUE-006 — ゲーム内のセリフをコードから管理データへ移す（設計）

- 基点: origin/dev b0d6788（#784 の後、読取のみ）。**設計のみ**。コード変更、PR、PDS 書込みはしていない。
- オーナー決定（2026-10-16、案A）: NPC やストーリーのセリフはソースコードに置かない。
- D 番号: docs/design と履歴で使われている D-DIALOGUE-003/004/005 の次の番号。

---

## 0. オーナーに決めてほしいこと（推奨つき）

| # | 判断 | 推奨 |
|---|---|---|
| J1 | 保存先: 新しいレコード `world.dialogue` を作り、決まった「場面」ごとにセリフを持たせる（§2）。NPC や内部マップのレコードに欄を足す案は採らない | 推奨どおり |
| J2 | コードとデータの境界（§1）。とくに【操作ガイド】の 2 行は **UI としてコードに残す**。宿泊の結果、パワー不足、受注・報告メニューの定型文、ギルドのメニュー文「冒険者ギルドへようこそ。どうする？」もコードに残す | 推奨どおり |
| J3 | 同梱している Blueskyちゃんの会話イラスト 2 枚（smile/worried）をやめ、NPC レコードの絵を使う。心配顔は既存の表情タグ `[sad]` で出す。dev と本番の `sad` の画像は同梱の worried と**同じ CID**（確認済み）なので見た目は変わらない | やめる |
| J4 | データが無いときに**コード側の代わりの文は持たない**。場面が無ければその会話を出さずに先へ進む（§3）。データが無いと宿屋が使えなくなるが、これは設定漏れの環境でだけ起きる | 代わりの文は持たない |
| J5 | 管理画面の種データのボタン（村人を入れる、ふたばの村のクエストを入れる、シナリオのサンプルを入れる、ふたばの村のシナリオを入れる）を**代わりを用意せずに消す**。村の地形を入れる「はじまりの村を入れる」は地図データなので残す（§6） | 推奨どおり |
| J6 | 調べて見つかった、今回の範囲外のセリフ: 店主の既定セリフ（`shop-data.ts` の GREETINGS など 13 文。店ごとの上書きは管理画面でできる）と精霊のセリフ（`spirit-lines.ts`。ワールドの外の機能）。**別の Issue にする** | 別 Issue |
| J7 | ギルドの初回あいさつで、ふたばだけ「村の」と言う違いを残すため、ギルドの場面に限って受付 NPC ごとの上書きを持てるようにする（§2） | 推奨どおり |
| J8 | 本番について: 昇格の対象に `dialogue` を足すところまでを今回やる。本番への実際の書込みはワールドを開くときに別途承認をもらう（§7） | 推奨どおり |
| J9 | 移す文言は #784 の後の今の文をそのまま使い、言い回しは変えない（付録A） | 推奨どおり |

---

## 1. 何を移し、何を残すか（境界）

**移す（データへ）**: 登場人物や地の文がその世界について語る文。
**残す（コードへ）**: 操作への応答、選択肢、結果、エラー、数値の通知、戦闘メッセージ。

| 場所 | 文 | 扱い |
|---|---|---|
| `world-opening.ts` | プロローグの「？？？」9 行（演出つき）、救護 6 行、ギルドへの誘い、手渡し 4 行（「やくそうを受け取った！」などの地の文を含む）、祝福の 1 行 | **移す** |
| `world-opening.ts` | 【操作ガイド】2 行 | 残す（J2。操作の説明なので、操作が変わるときに一緒に変わる） |
| `guild-greeting.ts` | 初回のあいさつ 2 行（ふたば用とほかの町用）、2 回目以降の「おかえり。…」 | **移す** |
| `npc-talk.ts` | 「冒険者ギルドへようこそ。どうする？」 | 残す（メニューの問いかけ） |
| `use-inn-talk.ts` | 「一晩{price}パワーです。泊まっていきますか？」、「ゆっくり休めたかい？　またどうぞ。」、「またどうぞ。」 | **移す** |
| `use-inn-talk.ts` | 「…に泊まった (パワー -N)…」、「…今はよく眠れているようだ。」、パワー不足の文、通信失敗 | 残す（edge の結果を伝える文） |
| `shop-modal.tsx` | 初めて店に来たときの説明 4 行 | **移す** |
| `shop-modal.tsx` | 作った、鍛えた、引き取った、の結果文 | 残す |
| `use-npc-quest-talk.ts`, `game-quest.ts` | 「うけますか？」「そろったらギルドで報告してね。」「いま紹介できる依頼はないよ。」「たのんだよ。」など | 残す（メニューと受注・報告の流れの定型文） |
| edge | `ResolverError` の文（例「パワーが たりない」）、戦闘の文 | 残す |
| `shop-data.ts` の既定の店主セリフ、`spirit-lines.ts` | — | 範囲外（J6、別 Issue） |

---

## 2. データの形

新しいレコード `world.dialogue`（rkey は `self`）を作る。ほかの `world.*` と同じく、管理者の PDS に置き、dev と本番で NSID を分ける。

```ts
// packages/core/src/dialogue-data.ts（新規）
export interface DialogueRecord { scenes: DialogueScene[]; updatedAt: string }
export interface DialogueScene { id: string; lines: SceneLine[] }
export interface SceneLine {
  text: string;            // 120 字まで。先頭に表情タグ [name] を書ける（D-DIALOGUE-005 と同じ規則）
  npcId?: string;          // 話者はその NPC。名前、会話イラスト、表情画像は npcs レコードから取る
  speaker?: string;        // 名前だけを出す話者（絵は出さない）。例「？？？」
  here?: true;             // 話者は「その場の人」。宿屋の名前、ギルドの受付 NPC、店主のどれか
  effects?: StoryEffect[]; // D-STORY-007 の演出（fade、silhouette、flash、tint）。既存の検証を使う
}
```

- 話者は `npcId`、`speaker`、`here` のどれか 1 つ。どれも無ければ地の文。
- **場面 ID はコードで決まった一覧**（どの場面をいつ出すかはコードが決める。文はデータが持つ）:

| 場面 ID | 使う所 | 使える差し込み |
|---|---|---|
| `opening.prologue` | 冒頭の虚空（「？？？」） | — |
| `opening.rescue` | 救護 | — |
| `opening.invitation` | ギルドへの誘い（手渡しの後、手渡しが無ければ救護の後） | — |
| `opening.handoff` | やくそうとそらのはねの手渡し | — |
| `opening.blessing` | リセット後だけ出す祝福 | `{power}` |
| `guild.first`、`guild.first:<npcId>` | ギルドの初回あいさつ | — |
| `guild.return`、`guild.return:<npcId>` | 2 回目以降のあいさつ | — |
| `inn.ask` | 宿の値段を聞く（このあと はい/いいえ） | `{price}` |
| `inn.thanks` / `inn.decline` | 泊まった後 / 断った後 | — |
| `shop.tutorial` | 店に初めて来たときの説明（最初の街の店だけ） | — |

- **条件つきの行（blessed）**: 条件を書く仕組みは足さない。祝福は別の場面 `opening.blessing` にして、コードがリセット後にだけつなげる。今の `starterHandoffLines(blessed)` と同じ順番（手渡し → 誘い → 祝福 → 操作ガイド）。
- **差し込み**: `{price}`（宿の値段。interiors の `inn.price`）と `{power}`（`WELCOME_POWER`）だけを使う。上の表にない差し込みは保存の時点で弾く。プレイヤー名は今どの行でも使っていないので足さない（使うときは、その場面に使える差し込みとして足す）。
- **表情**: 救護の心配顔の 2 行は `npcId: futaba-bluesky` にし、本文の先頭に `[sad]` を付ける。笑顔の行は NPC の通常の絵（`portraitImage`）を使う。`expressionImages.sad` の画像は同梱の worried と同じ CID であることを確認した（dev、本番とも）。
- **演出**: プロローグ 1 行目の `fade black` と `silhouette`、救護 1 行目の `fade clear`、`silhouette false`、`flash white` をデータに入れる。シルエットの画像は演出の一部なのでコードに残す。
- **ギルドの受付ごとの上書き（J7）**: `guild.*:<npcId>` があればそれを使い、無ければ `guild.*` を使う。ほかの場面は受付ごとに上書きできない。
- **検証**（`validateDialogue`。core にあるので web と edge で同じものを使う）: 知らない場面 ID と重複を弾く。上書きは `guild.*` だけに認める。決まった場面はすべて空にできない（壊れた編集で冒頭が消えないように）。1 場面は 20 行まで。話者の欄は 1 つまで。差し込みは使えるものだけ。演出は `isStoryEffectList` で確かめる。
- **NPC の参照**: `npcId` と上書きに書いた `<npcId>` が実在するかは**保存するときだけ**確かめる。dialogue の保存では保存済みの npcs を見る。NPC の保存では、dialogue が参照している NPC を消させない（`missingStoryBattle` と同じ流儀）。読み込むときは確かめない（参照が切れたせいで全体が消えないように）。表示のときに NPC が見つからなければ、その行は地の文として出す。

---

## 3. 読み込みと、データが無いとき

- 読み込み: `ADMIN_WORLD_RECORDS` の最後（story の後）に `dialogue` を足す。web は `loadAuthoredWorld`、edge は `ensureAuthoredWorld` で、既存の `loadAdminWorld` を通る。適用の規則も既存と同じで、レコードが無ければ触らず、あれば検証してから入れ替える。web では `use-world-load` が `loadAuthoredWorld` を待ってから冒頭を始めるので、読み込み中に冒頭が始まることはない。
- **コード側の代わりの文は持たない（J4）**。理由は 3 つ。
  1. この会話は npcs と interiors のレコードの上に成り立っている。この 2 つにも代わりのデータは無い（ふたばの村も宿屋も Blueskyちゃんもデータにしか無い）。文だけ代わりを持っても、遊べる状態は増えない。
  2. 代わりの文を持つと、同じ文がコードとデータの 2 か所にでき、今回なくしたい二重管理に戻る。
  3. KV の last-good は、無いと戦闘が壊れる monsters のために作ったもの。会話はそこまで重くないので使わない。
- データが無いときの動き（どれもゲームを止めない）:

| 場面が無い | 動き |
|---|---|
| `opening.prologue` / `opening.rescue` | 冒頭を始めない。`ONBOARDING_DONE_KEY` も立てないので、データが入った後に開くと冒頭が 1 回流れる。移動はできる |
| `opening.handoff` | 手渡しの窓を出さない。道具は今までどおり渡る（`gotStarterFeather` は今の仕組みのまま）。リセット後の祝福演出はその回だけ出ない（+20 はもう付いている） |
| `guild.*` | あいさつを飛ばしてギルドのメニューを出す |
| `inn.ask` | 扉に入っても宿の会話を開かない（泊まれない）。設定漏れの環境でだけ起きる |
| `inn.thanks` / `inn.decline` | その窓を出さない |
| `shop.tutorial` | あいさつだけを出す。説明を読んだ印も立てない |

- 手当て: 決まった場面がすべて揃っていないと保存できないようにする（§2）。ワールドを開く前の確認項目に「本番に dialogue がある」を入れる（§7）。

## 4. edge（サーバー）

- edge はこれらの文を**使わない**。宿の値段、泊まれるかどうか、払う額は今までどおり edge が決め、`inn` / `innDenied` の数値を返すだけ。文を組み立てるのは web。
- edge の変更は 2 つだけ。(a) 共通のローダーなので `dialogue` も読む。PDS の読取りが isolate ごとに 5 分に 1 回増えるが、ゲームでは使わない。(b) 管理データ API（`ADMIN_DATA_NAMES`）に `dialogue` を足し、PUT のときに `validateDialogue` と保存済みの npcs による参照チェックを通す。これで CLI からも同じ検証で書ける。

## 5. 管理画面

新しいページ `/admin/dialogue`「会話」を作り、管理ダッシュボードにリンクを足す。既存のページを広げない理由: どの場面も特定の NPC やシナリオイベントのものではないので、1 か所にまとめたほうが探しやすい。

```
← 管理   会話   [保存]
┌ 場面一覧 ─────────┐ ┌ 冒頭: 救護 (opening.rescue) ───────────────────┐
│ 冒頭                │ │ 差し込み: なし   [プレビュー]                     │
│  ・プロローグ 9行   │ │ 1 [話者: NPC ▼ Blueskyちゃん] [[sad]……聞こえる？…] │
│  ・救護 6行   ←選択 │ │    演出: [暗転を戻す ×][シルエットを消す ×][白い閃光 ×][＋演出] │
│  ・誘い 1行         │ │    [↑][↓][削除]                                   │
│  ・手渡し 4行       │ │ 2 [話者: NPC ▼ Blueskyちゃん] [[sad]けがしてる…]   │
│  ・祝福 1行         │ │ 3 [話者: 地の文 ▼] [少女はやくそうを取り出し…]     │
│ ギルド               │ │ …                                                  │
│  ・初回 / 2回目以降  │ │ [＋行]                                             │
│  ・ふたばの上書き    │ └────────────────────────────────────────────────┘
│  [＋受付ごとの上書き]│
│ 宿屋 / なんでも屋    │
└─────────────────────┘
話者: 地の文 / NPC（一覧から選ぶ）/ 名前だけ（自由入力）/ その場の人
```

- 演出の選び方は `/admin/scenario` の演出プリセットの部品を使い回す。プレビューは既存の `DialogueWindow` で、表情タグを外して表示する。
- 読み込みは「読めなかったら保存させない」形にする（既存の `getAuthoringRecord` と同じ）。レコードが無い環境では空の状態から始まり、全部の場面を埋めるまで保存できない。

## 6. コードにある種データをやめる

- **消す**:
  - `starter-town-quests.ts`、`starter-town-scenario.ts`、`scenario-samples.ts`
  - `interior-samples.ts` の `starterTownNpcs` と `starterTownNpcsPlacementError`
  - 管理画面の 4 つのボタン: admin-npcs「ふたばの村の村人を入れる」、admin-quests の「ふたばの村のクエストを入れる」、admin-scenario の「サンプルを入れる」と「ふたばの村のシナリオを入れる」
- **代わり**: 管理画面には用意しない（J5）。新しい環境は、既存の `copy-admin-data-to-dev.mjs`（本番 → dev）か、`admin-data.mjs put` で fixture の JSON を入れる。
- **残す（地図データでセリフではない）**: `buildStarterTownTiles`、`starterTownInterior`、`starterTownGates`、座標の定数（`STARTER_TOWN_*`）、admin-interiors の「はじまりの村を入れる」。宿の名前「ふたばの宿」と店の名前は施設の名前で、セリフではない。`starter-town-shop.ts`（品揃え。使っているのはテストだけ）もセリフではないので今回は触らない。
- **テスト用の fixture**: `packages/core/src/__tests__/fixtures/starter-town.json`（npcs、quests、scenario、SAMPLE の 3 イベント）と `fixtures/dialogue.json` を作る。読み込みは `helpers/starter-town-fixture.ts`（`monster-fixture.ts` と同じ流儀）。中身は**今のコードの値をそのまま JSON にしたもの**で、PR を作るときに一度だけ書き出す（書き出しの手順は repo に残さない）。テストが見ている文言が変わらないので、アサーションはほぼそのまま使える。fixture はテストの入力であって、正本ではない（正本は PDS）。

## 7. 移行

**dev**（承認を受けて実施。手順は docs/issue-695 に従う）
1. PR1 を dev の edge に配備する（API が `dialogue` を受け付けるようにする）。
2. `admin-data.mjs get npcs` で `futaba-bluesky` と、受付 NPC 5 人の id と名前が付録Aと合っていることを確かめる。
3. 付録Aの JSON を repo の外に保存し、`admin-data.mjs put dialogue <file> --dry-run` で差分を見る。承認をもらってから put する。
4. その後に PR2 の web を dev に配備する。古い web は `world.dialogue` を読まないので、データを先に入れても安全。これで dev の画面から文が消える時間は無い。

**本番**（ワールドは閉じている）
- 本番の `world.*` はまだ一部しか無い（`world.npcs` は 8 人で、まだ分かち書きの文。monsters、monsterArt、story、jobs、dialogue は無い）。
- `/world` は `WORLD_PREVIEW_ENABLED` で閉じているので、コードを先に本番へ出しても利用者には影響しない。
- 今回やるのは、`promote-admin-records.mjs` の `PROMOTE_NAMES` に `dialogue` を足すところまで。
- ワールドを開くときは、リリース作業の中で dev → 本番へ必要な `world.*` をまとめて昇格する（退避、CAS、dry-run、オーナーの承認つき）。その確認項目に「dialogue があり、決まった場面がすべて揃っている」を入れる。

## 8. テスト

| 種類 | 対象 | 変更 |
|---|---|---|
| core 新規 | `dialogue-data.test.ts` | 知らない場面、上書きは guild だけ、決まった場面が欠けている、差し込みの許可、話者は 1 つまで、120 字、演出の検証 |
| core | `admin-world-loader.test.ts` | dialogue が適用される。無ければ触らない |
| core | `starter-town-quests` / `starter-town-tutorial` / `interior` / `scenario` の各テスト | 種データの関数の代わりに fixture を使う。`starterTownNpcsPlacementError` のテストは消す |
| edge | `admin-data.test.ts` | dialogue の PUT（検証、存在しない npcId を弾く）。名前一覧が揃っているかの検査に dialogue を足す |
| edge | `game-quest.test.ts` | fixture を使う |
| web | `guild-greeting.test.ts` | データからあいさつを作る（上書き → 既定 → 無いとき） |
| web 新規 | 場面の組み立ての単体テスト | 冒頭、手渡し、祝福、ガイドの順番。差し込み。場面が無いときは冒頭を始めず、印も立てない |
| web | `world-authoring.test.ts`、`futaba-guild.test.ts` | fixture を使う。`starter-town-authoring.test.tsx` は消すボタンのテストなので消す |
| e2e | opening-story、tutorial、guild-dialogue-steps、npc-expression-portrait、world-inn-talk | 隔離した PDS のレコードに `world.dialogue`（fixture）を足す。心配顔は `expressionImages.sad`（worried の原本）から配る。文言のアサーションは変えない |
| e2e | admin-starter-village、admin-npc-placement | 村人を入れる部分を消し、fixture を使う |
| e2e 新規 | admin-dialogue | 1 行を編集し、演出を足して保存すると、PUT の中身に反映される |

## 9. PR の分け方

1. **PR1 core + edge + CLI**:
   - `dialogue-data.ts`（型、検証、`setDialogue`、`sceneLines(id, vars)`）
   - ローダーに `dialogue` を足す
   - 管理データ API、`admin-data.mjs`、`PROMOTE_NAMES`
   - core と edge のテスト
   - この PR だけでは、ゲームに見える変化は無い
2. **dev データの put**（承認のゲート。§7）
3. **PR2 web**:
   - `world-opening.ts`、`guild-greeting.ts`、`use-inn-talk.ts`、`shop-modal.tsx` を場面から読むように変える
   - 同梱の Blueskyちゃんの画像をやめる（J3）
   - `/admin/dialogue` を作り、NPC を保存するときの参照チェックを足す
   - `dialogue.json` の fixture、web のテスト、e2e
4. **PR3 種データの撤去**: §6（PR2 と並行して進められる）

## 10. リスク

- 管理画面で文を書き換えると、冒頭の体験がその場で変わる。保存時の検証と、決まった場面を空にできない制約で、窓が壊れることは防げる。言い回しを変えるのは運用の判断。
- npcs だけ読めずに dialogue が読めた、という一部だけの失敗では、話者の名前と絵が出ず地の文になる。まれで、ゲームは止まらない。
- fixture は書き出した時点の値で固定される。dev のデータと後でずれていくが、テストは仕組みを確かめるもので、文の正本ではない。
- 本番を開くには dialogue 以外の昇格も要る。本番の npcs はまだ分かち書きの文。これは今回の範囲外だが、開く前の必須作業。
- edge の PDS 読取りが少し増える（isolate ごとに 5 分に 1 回）。

---

## 付録A 移行する文（dev に put する JSON。#784 の後の今の文そのまま）

```json
{ "scenes": [
 { "id": "opening.prologue", "lines": [
  { "text": "……ここは、どこ？", "effects": [{ "kind": "fade", "to": "black" }, { "kind": "silhouette", "show": true }] },
  { "speaker": "？？？", "text": "やっと届いた。きみの言葉が。" },
  { "speaker": "？？？", "text": "むこうの空は今、色を失っている。七羽の鳥が、眠ってしまったから。" },
  { "speaker": "？？？", "text": "ぼくにはもう、飛ぶ力が残っていない。" },
  { "speaker": "？？？", "text": "だから、きみにギフトを渡す。きみの言葉の形が、そのままきみの力になる。" },
  { "text": "【ギフト】ことばの ちからを授かった！" },
  { "speaker": "？？？", "text": "むこうで、きっと……いや、なんでもない。" },
  { "speaker": "？？？", "text": "――空を、たのんだよ。" },
  { "speaker": "？？？", "text": "……あいつに、見つかる前に。" } ] },
 { "id": "opening.rescue", "lines": [
  { "npcId": "futaba-bluesky", "text": "[sad]……聞こえる？　大丈夫？", "effects": [{ "kind": "fade", "to": "clear" }, { "kind": "silhouette", "show": false }, { "kind": "flash", "color": "white" }] },
  { "npcId": "futaba-bluesky", "text": "[sad]けがしてる……。待って、やくそうがあるから。" },
  { "text": "少女はやくそうを取り出し、そっと傷の手当てをしてくれた。" },
  { "npcId": "futaba-bluesky", "text": "よかった……！　気がついたんだね。" },
  { "npcId": "futaba-bluesky", "text": "村の前で倒れてたから、心配したよ。" },
  { "npcId": "futaba-bluesky", "text": "わたしはBluesky。この村の冒険者ギルドで受付をしてるの。" } ] },
 { "id": "opening.invitation", "lines": [
  { "npcId": "futaba-bluesky", "text": "村のギルドで少し休んでいかない？　井戸の北東の建物だよ。ゆっくりおいで。" } ] },
 { "id": "opening.handoff", "lines": [
  { "npcId": "futaba-bluesky", "text": "これも持っていて。また痛くなったら使ってね。" },
  { "text": "やくそうを受け取った！" },
  { "npcId": "futaba-bluesky", "text": "そらのはねもあげるね。行ったことのある街へ戻れるの。" },
  { "text": "そらのはねを受け取った！　コマンドの「どうぐ」から使えます。" } ] },
 { "id": "opening.blessing", "lines": [ { "text": "【ギフト】ことばの ちからであおぞらパワーが{power}増えた！" } ] },
 { "id": "guild.first", "lines": [
  { "here": true, "text": "来てくれたんだね。体の具合はどう？" },
  { "here": true, "text": "ここがこの町の冒険者ギルドだよ。少し休んでいってね。" } ] },
 { "id": "guild.first:futaba-bluesky", "lines": [
  { "here": true, "text": "来てくれたんだね。体の具合はどう？" },
  { "here": true, "text": "ここが村の冒険者ギルドだよ。少し休んでいってね。" } ] },
 { "id": "guild.return", "lines": [ { "here": true, "text": "おかえり。冒険者ギルドへようこそ。" } ] },
 { "id": "inn.ask", "lines": [ { "here": true, "text": "一晩{price}パワーです。泊まっていきますか？" } ] },
 { "id": "inn.thanks", "lines": [ { "here": true, "text": "ゆっくり休めたかい？　またどうぞ。" } ] },
 { "id": "inn.decline", "lines": [ { "here": true, "text": "またどうぞ。" } ] },
 { "id": "shop.tutorial", "lines": [
  { "here": true, "text": "ここはなんでも屋。あおぞらパワーと素材を持ってくれば、装備を作るよ。" },
  { "here": true, "text": "できばえは−1〜+5。うんが高いほどいい品になりやすい。" },
  { "here": true, "text": "同じ品を2つ持ってくれば、1つ上に鍛えてやろう。" },
  { "here": true, "text": "素材はこのへんのモンスターが落とす。いらない素材は引き取ってパワーに変えるよ。" } ] }
] }
```

補足:
- `shop.tutorial` の最初には、今と同じく店主のあいさつ（`keeper.greeting`）をコードが付ける。店主に名前が無いときは、今と同じく「」で囲んだ地の文にする。
- 「ギフト」の行にある「ことばの ちから」の空白は今のコードのままにしている。

## 付録B 調べた根拠

- コードのセリフ: `apps/web/src/lib/world-opening.ts`、`guild-greeting.ts`、`use-inn-talk.ts`、`npc-talk.ts`、`use-npc-quest-talk.ts`、`components/shop-modal.tsx`、`packages/core/src/shop-data.ts`、`spirit-lines.ts`。edge には NPC のセリフは無い（あるのはエラー文と戦闘文だけ）。
- 種データを使っている所: admin-npcs、admin-quests、admin-scenario、admin-interiors、core / edge / web のテスト 11 ファイル、e2e 8 ファイル。
- 管理者 PDS（読取りだけ）: dev には `world.*` が 12 種類ある。本番には interiors、items、map、npcs、quests、scenario、shops、tileArt だけ。`futaba-bluesky` の `portraitImage` の CID は同梱の smile と同じ、`expressionImages.sad` の CID は同梱の worried と同じ（dev、本番とも）。
