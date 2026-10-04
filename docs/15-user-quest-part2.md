# 15 - ユーザー発クエスト (依頼掲示板) — 第 2 部 ([目次](./15-user-quest.md))

## UI 設計

### A. クエスト発行画面 (`/quests/new`)

- タイトル (1 行、最大 80 字)
- 本文 (markdown 風プレーン、最大 1500 字、改行可)
- タグ (chip 形式で最大 8 個)
- 「求めるジョブ」(任意、16 ジョブから 1 つ。chip)
- **報酬ポイント (整数)**: 「あなたの名前のポイントを N pt 発行する」と明示。テキスト下に「これまでの発行履歴: 合計 X pt / クエスト Y 件」を表示し、自分の発行量の感覚をつかめるようにする
- **募集期限** (任意、date picker)。期限内のみ応募可、後から延長/短縮できる旨を補助テキストで明示
- 公開範囲: **public 固定** (MVP では切替 UI を出さない)
- 「Bluesky にも告知する」チェック (**default ON**) + 告知文面のプレビュー & 編集欄
- 「クエストを出す」ボタン

### B. クエスト一覧 / 検索 (`/quests`)

- 大きく 4 タブ: 「募集中」「自分が出した」「自分が応募した」「過去のクエスト (ポートフォリオ)」
- フィルタ: タグ / ジョブ / 締切ありなし / フォロー中のみ / 報酬ポイント発注者 (チップ選択)
- 各カードに: タイトル、発注者の avatar+job バッジ、本文冒頭 100 字、tag chip、応募数、締切までの残日数、**報酬表記** (例: `alice ⓟ 12000`)

### C. クエスト詳細 (`/quests/:uri`)

- ヘッダー: 発注者の avatar + handle + ジョブバッジ + LV + 報酬ポイント (`aliceポイント 12000`)
- タイトル + 本文 + tag + 募集期限 (残り時間 or 「期限切れ」表示)
- 状態表示 (`open` / `assigned` / `reported` / `completed` / `cancelled`、+ 期限切れバッジ)
- 応募者リスト (発注者本人のみ展開して見える。応募メッセージ + 「受託者に指定」ボタン)
- 自分が応募者なら自分の応募メッセージを表示 + 「取り下げる」
- 自分が受託者で `assigned` なら「**完了報告する**」(成果物 URL + 一言コメント入力)
- 自分が発注者で `reported` なら「**承認する**」(報酬 pt は元クエスト固定で増減不可、確認のみ) / 「**やり直しを依頼**」(コメント必須)
- 完了済みなら completion チェーン (`assigneeReport` → `requesterApproval`) を時系列で表示 + 確定した発行ポイントを上部に大きく表示
- 発注者向けアクション:
  - 「**募集期限を延長/短縮**」(deadline の編集。期限切れ状態からの再有効化はこのボタンから)
  - 「**キャンセル**」(status を `cancelled` に書き換え。応募者にも通知)

### D. ポートフォリオ画面 (`/me/portfolio` または プロフィール内タブ)

aozoraquest 利用者の **「これまでの活動の証」** を集約表示。本人視点と他人視点で内容が変わる。

#### 受託履歴 (うけたクエスト)

- 一覧 (新しい順): タイトル / 発注者 avatar+handle / 状態 / 完了日 / 獲得ポイント (例: `aliceポイント +12000`) / 自分の成果物リンク
- フィルタ: タグ / 発注者別 / 期間
- **サマリ指標**:
  - 受託総数 (= 受託者に指定された全クエスト数)
  - 内訳: 成功 (`completed`) / 失敗 (途中で頓挫) / キャンセル (= 発注者の取り下げに巻き込まれ)
  - 獲得ポイントを発注者ごとに集計 (= 下記「ポイント保有状況」と同じ値)
  - 関わった発注者数 (= ユニーク発注者 DID 数。「何人から受託したか」)

#### 発注履歴 (出したクエスト)

- 一覧: タイトル / 受託者 avatar+handle / 状態 / 発行 pt
- **サマリ指標**:
  - 発注総数 (= 自分が出した全クエスト数)
  - 内訳: **成功** (`completed`) / **失敗** (`cancelled` かつ assignee 指定済みだった = 途中で頓挫) / **キャンセル** (`cancelled` かつ assignee 未指定 = 応募ゼロ・自主取り下げ・期限切れ)
  - **何人に発行したか** (= 完了時に報酬を渡したユニーク受取人 DID 数): 例「47 件のクエスト完了で、12 人に alice ポイントを発行」
  - **累計発行ポイント** (= 自分発行ポイントの総流通量): 例 `aliceポイント 累計発行 152,000 pt / 47 件`
  - 発行頻度の推移 (月別グラフ、Phase 3+)

「失敗」と「キャンセル」の区別は **assignee 指定の有無** で機械判定する。schema 上のステータスは `cancelled` 1 種で持ち、UI 側で分類して表示する。意図的に別 status を立てないのは、Phase 1 のスコープを膨らませないため。

#### ポイント保有状況

自分が持っている **他人発行ポイント** を種類別に一覧:

```
🏅 保有ポイントランキング (発行者別)

1.  aliceポイント    18,400 pt   (alice 総発行 152,000 中、シェア 12.1%)
2.  claudeポイント       950 pt   (claude 総発行 4,800 中、シェア 19.8%)
3.  satoポイント         500 pt   (sato   総発行 12,000 中、シェア  4.2%)
...
```

- **何種類の発行者から獲得しているか** (= 信頼の幅)
- **総発行量の何%を持っているか** (= 個別発行者からの厚い信頼の指標、default 表示・opt-out)
- 「シェア%」は **発行者本人の発行履歴を集計** して算出 (= computed)。リアルタイムで他人の発行が増えれば自分のシェアは相対的に薄まる
- 発行者が Bluesky 上でアカウントを削除した場合、その種類のポイントは **「(削除済み発行者) ポイント」のグレー表示** で残す (集計には含める)

#### 公開ポートフォリオ (他人視点)

他人がこの画面を見るときに表示するのは以下:

- 公開設定が ON (**default ON**、profile で OFF にできる = opt-out) の場合のみ表示
- 受託履歴 (完了済みのみ) + 受託サマリ (受託総数 / 成功率 / 関わった発注者数)
- 累計発行ポイントの総量、発行件数、**何人に発行したか**
- 自分が出したクエストの成功率 (= 成功 / 発注総数)
- **保有ランキング Top 5 (default ON)** : 「どの発行者のポイントを多く持っているか」を見せる。設定で OFF にできる (= opt-out)

MVP では全クエストが `visibility=public` なので本文は常に表示される。将来 followers / private を入れたとき、`visibility=public` のものだけ表示してそれ以外は件数のみカウントに切り替える。

### 集計の計算式 (擬似コード)

ポートフォリオやサマリで表示する値はすべて **client computed**。MVP では PDS から fetch した一覧を in-memory で集計する。

```ts
// 期限切れ判定
const isExpired = (q: UserQuest) =>
  q.deadline != null && new Date(q.deadline) < new Date() && q.status === 'open';

// 「失敗」と「キャンセル」の区別 (発注者側集計)
const outcomeOf = (q: UserQuest): 'success' | 'failure' | 'cancelled' => {
  if (q.status === 'completed') return 'success';
  if (q.status === 'cancelled' && q.assignee != null) return 'failure';
  if (q.status === 'cancelled' && q.assignee == null) return 'cancelled';
  return 'inProgress' as never; // 進行中はサマリ集計から除く
};

// 「sato が持つ alice ポイント」: alice の completed quest のうち assignee=sato
const holdings = (issuerQuests: UserQuest[], me: Did) =>
  issuerQuests
    .filter(q => q.status === 'completed' && q.assignee === me)
    .reduce((sum, q) => sum + (q.rewardPoints ?? 0), 0);

// 「alice の総発行 (= 発行ポイント流通量)」
const totalIssued = (issuerQuests: UserQuest[]) =>
  issuerQuests
    .filter(q => q.status === 'completed')
    .reduce((sum, q) => sum + (q.rewardPoints ?? 0), 0);

// 「sato が持つ alice ポイントのシェア %」
const shareOf = (issuerQuests: UserQuest[], me: Did) => {
  const total = totalIssued(issuerQuests);
  return total === 0 ? 0 : (holdings(issuerQuests, me) / total) * 100;
};

// 「何人に発行したか」(発注者視点、ユニーク受取人数)
const distinctRecipients = (myQuests: UserQuest[]) =>
  new Set(myQuests.filter(q => q.status === 'completed').map(q => q.assignee!)).size;

// 「関わった発注者数」(受託者視点)
const distinctRequesters = (myReceivedQuests: UserQuest[]) =>
  new Set(myReceivedQuests.filter(q => q.status === 'completed').map(q => questOwnerDid(q.uri))).size;
```

### 集計データの取得とキャッシュ戦略

ポートフォリオ画面表示時に集計対象を fetch する:

| 集計対象 | 取得元 | キャッシュ |
|---|---|---|
| 自分の発注した quest | 自分の PDS `listRecords(app.aozoraquest.userQuest)` | localStorage 24h, ETag で差分 |
| 自分が受託した quest | 自分の PDS のうち assignee=self のもの (= 受託履歴は自分の `questCompletion` から questUri を逆引き) | localStorage 24h |
| 特定発行者 (例: alice) の総発行 | 発行者 PDS `listRecords(app.aozoraquest.userQuest)` | localStorage 24h |
| 公開クエスト一覧 (募集中) | 主管理者 PDS `getRecord(app.aozoraquest.questIndex/self)` | ETag 駆動、画面開く毎に再取得 |

**MVP の規模仮定**: 1 ユーザーあたり生涯発注 < 1000 件、受託 < 1000 件、保有他人ポイント < 100 種類 を想定。in-memory 集計で十分回る。これを超える規模 (= 数千〜万) になった場合は Phase 3 で:
- 集計結果を `app.aozoraquest.questDigest` (新規) として自分の PDS に書き溜める (ローカル集計のクラウド永続化)
- もしくは Worker 側で「公開ポートフォリオ集計済み」を questIndex の付随情報として保持

を選ぶ。MVP では深追いしない。

### E. マルチカラム統合 (Phase 3)

将来のマルチカラム化と統合した時のカラム種類例:

- **募集中**: status=open のすべて (フォロー内 / 全体切替)
- **マイクエスト**: 自分が出したもの (status 別)
- **応募中**: 自分が応募したもの
- **特定ジョブの募集**: 例「賢者ジョブからの依頼だけ」
- **タグフィルタ**: 例「#art #illust」
- **特定の発行者のポイントが付くクエスト**: 例「aliceポイントの出るクエストだけ」

各カラムは独立に refresh / scroll する。

### F. 通知

**Bluesky の通知 (= mention 付き post) に乗せる**。aozoraquest 専用通知 NSID は作らない。

aozoraquest が以下のタイミングで Bluesky に通知 post を生成する (相手を mention) :
- 「応募が来た」 → 発注者宛
- 「受託者に指定された」 → 応募者宛
- 「完了報告が来た」 → 発注者宛
- 「承認された / やり直しを依頼された」 → 受託者宛

利点: ユーザーが aozoraquest を開いていなくても Bluesky 標準クライアントで気付ける。
欠点: Bluesky の TL に通知 post がにじみ出る。文面と頻度は丁寧に設計する (例: short URL + 一行、リプライなしの flat post)。

**頻度の上限と opt-out** (= 「通知 post 氾濫」対策、リリース前):
- aozoraquest 内設定で「Bluesky 通知 post を生成する」を opt-out 可能にする (現状の `aozoraquest:postQuestNotifications` を流用、Phase 2 完了時点で実装済み)
- **同じ relationship に対する重複通知を抑止** (例: 同じ受託者への report → approve の 2 連続は 1 通にまとめる) — Phase 3 後半で frequency cap を入れる
- 連続承認等の bulk operation 時は 1 通にまとめて post (将来 batch 機能を入れたとき)
- mention を多用するため Bluesky のレートリミットに当たりやすい点も注意 (= 自前で 1 分 30 通の cap を入れる)

aozoraquest 内のクエスト一覧 / 詳細画面でも未読バッジを出す (= 通知 post を「既読」状態にしているかどうかは Bluesky 側の状態を見て判断)。

## 報酬・経験値・バッジ

### 報酬ポイント (発注者発行通貨)

- 発注時に発注者が任意の整数 pt を指定
- 完了 (発注者承認) 時、受託者の **「発注者DID ポイント」保有量に +N pt**
- 通貨種類は発注者 DID で識別。**ポイントは合算されず、種類別に独立**
- 例: 「alice → sato への 12000 pt 発行」「claude → sato への 500 pt 発行」は別物として両方計上
- 発行上限なし。価値は発注者の信用に依存
- **承認時の増減は不可**。応募時点で受託者が見ていた値で固定発行する (透明性のため)

### システム XP (共通)

| イベント | 受託者 | 発注者 |
|---|---|---|
| クエスト完了 (発注者承認時) | +200 XP | +50 XP |
| クエスト発行 | - | +10 XP (一日 1 件まで) |
| 応募 | +5 XP (一日 3 件まで) | - |
| 受託者指定 | - | - |

ステータス軸への配分は **依頼内容のタグから推定** する (例: タグに `#illust` `#art` があれば LUK、`#code` `#review` があれば INT)。タグ→ステータスのマッピングは **オーナー (alice) が管理する固定マップ** をアプリ内定数として持ち、PR で更新する。LLM 動的判定は使わない (運用の予測可能性のため)。Phase 2 で実装。

### バッジ案 (Phase 2 以降)

- 「初発注」: 初めて発行
- 「初受託」: 初めて完了 (受託側)
- 「世話役」: 完了 5 件 (発注側)
- 「相棒」: 同じ相手と 3 回完了
- 「人脈」: 異なる 10 発行者からポイントを獲得
- 「信頼の柱」: 自分発行ポイントの累計流通が 100,000 pt 超

## モデレーション

### MVP (Phase 1)

- Bluesky のブロックリストを尊重する。ブロックしたユーザーのクエストは出さない / 応募できない
- スパム対策の上限:
  - 1 ユーザーが同時に `open` にできるクエスト: **3 件**
  - 1 日に発行できるクエスト総数: **5 件**
  - 1 ユーザーが同時に `応募中` にできるクエスト: **10 件**

### Phase 2 以降

- `app.aozoraquest.questReport` レコードによる通報
- 通報が一定数たまったクエストは UI 上で薄く表示 / 自動非表示
- 運営 (admin) が `app.aozoraquest.questModeration` でラベル付け (NSFW / spam / 不適切)
- Bluesky のラベル機構 (`com.atproto.label.defs`) に乗せられないか検討

### 法的・倫理的なガードレール

- **金銭授受の禁止を ToS に明記**。`rewardPoints` は aozoraquest 内のゲーム指標であり、法定通貨でも証券でもない、と明示
- 個人ポイントは aozoraquest 外部で交換・換金できる仕組みを **作らない**
- アプリは仲介責任を負わない。当事者間トラブルはユーザー間で解決
- 当事者の DM / 連絡先交換はアプリ外 (Bluesky DM / メール) で行う

## 段階導入ロードマップ

### Phase 1: MVP (発行と表示)

期間目安: 2-3 週間

- [ ] `app.aozoraquest.userQuest` レキシコン定義 & 永続化
- [ ] `app.aozoraquest.questIndex` レキシコン定義
- [ ] Cloudflare Worker (`apps/edge` 新設) に `POST /index/quest` + 認証 + 検証 fetch + putRecord
- [ ] Worker の alice セッション保持 + 1 日 1 回の refresh Cron Trigger
- [ ] クエスト発行 UI (`/quests/new`) + Worker への登録呼び出し
- [ ] クエスト一覧 (`/quests` の「募集中」「自分が出した」タブ、questIndex から取得)
- [ ] クエスト詳細 (`/quests/:uri`) 表示 (原本 PDS から fetch)
- [ ] スパム上限と Worker レート制限

このフェーズでは応募・受託・完了は **入れない**。「掲示板に貼る」だけ。Bluesky 上で連絡先交換して終了。

### Phase 2: 応募と受託

期間目安: 2-3 週間

- [ ] `app.aozoraquest.questApplication` レキシコン
- [ ] Worker に `POST /index/application` エンドポイント追加
- [ ] 応募 UI (詳細画面に応募メッセージ入力)
- [ ] 応募者一覧表示 (発注者にのみ展開、questIndex.applications から fetch)
- [ ] 「受託者に指定」ボタン (= 元 quest record の assignee 更新 + Worker 再 POST で index 同期)
- [ ] `app.aozoraquest.questCompletion` レキシコン (assigneeReport / requesterApproval / requesterRevision)
- [ ] 完了報告 → 発注者承認 UI
- [ ] ポイント発行ロジック (= computed 残高、新 NSID 不要)
- [ ] XP 付与ロジック (発注者・受託者)
- [ ] ポートフォリオ画面 (受託履歴 / 発注履歴 / 保有ランキング)

### Phase 3: マルチカラム化と発見性

期間目安: 3-4 週間

- [ ] マルチカラム基盤 (デスクトップ ≥768px)
- [ ] 「募集中クエスト」カラム
- [ ] フィルタ (タグ・ジョブ・締切・フォロー中のみ・発行者別)
- [ ] ジョブ別 / タグ別 / 発行者別カラム
- [ ] 通知 (応募が来た等)
- [ ] 公開ポートフォリオ (他人のページ)

### Phase 4: モデレーション

期間目安: 2 週間

- [ ] 通報レコード
- [ ] ブロック / 非表示
- [ ] 運営ラベル
- [ ] 不適切判定の自動化検討

### Phase 5 以降 (将来)

- バッジ
- 評価・レビュー
- 同じ相手との繰り返し相性スコア
- Bluesky の `app.bsky.feed.generator` で公開フィード化

## スコープ外 (今回触らない)

- 金銭授受の仲介・決済
- 物理的な配送やリアル待ち合わせの安全保証
- 既存日次クエスト (システム生成) の仕組み変更
- AI による応募者推薦
- カレンダー連携・締切通知のメール送信
- マルチカラム機能本体 (本書は Phase 3 で統合する前提を書くだけ)

## 決定事項

| 項目 | 決定 | 補足 |
|---|---|---|
| **visibility** | **public のみ** | followers / private は実装しない。schema 上 `visibility` enum も `["public"]` 単独にする |
| **Bluesky 自動告知** | **default ON、文面はユーザーが編集可能** | 編集テンプレを発行画面に出して、必要に応じて書き換えてから post |
| **受託完了の経験値** | **固定 XP (`XP_REWARDS.questComplete` = 100)** | 受託して完了 (発注者が承認) した 1 件あたり一律 100 XP。**現職 LV (jobLevel) に加算**する (プレイヤー Lv は戦闘力に影響しないため #507/#508 で廃止)。内容 (タグ) で配分を変える「ステータス XP」概念は廃止 (オーナー判断 2026-06: クエストで入るのはレベルアップ用の経験値だけ)。`questXpScalar` が完了集合から派生算出 (二重加算なし) |
| **通知システム** | **Bluesky notification に乗せる (= aozoraquest が通知 post を生成)** | 専用 NSID は作らない。通知 post を mention 付きで出すことで、ユーザーの Bluesky 標準クライアントでも気付ける |
| **タイトル/本文の最大長** | **タイトル 80 字 / 本文 1500 字** | 妥当と判断、これで進める |
| **承認時の報酬調整幅** | **増減なし**。元クエストの `rewardPoints` でそのまま発行する | `questCompletion.rewardPoints` は別途持たず、元 record の値を信頼する |
| **自動失効** | **なし**。失効は発注者の明示操作のみ | 募集期限 (`deadline`) は発注者が任意で設定 / 後から変更可能。期限超過は UI 表示のみで status は触らない。「ステータスを変えるのは発注者だけ」というシンプルな原則 |
| **ポイント保有ランキング公開** | **default ON** | プロフィール設定で OFF にできる (opt-out) |
| **シェア% 表示** | **default 表示、opt-out** | 「総発行の N% を保有」は default で見える。設定で消せる |
| **発行者アカウント削除時** | **グレー表示** | 削除済み発行者のポイントは「(削除済み発行者) ポイント」と灰色で表示、集計には残す |

## 付録 A: 受託完了の経験値 (旧「タグ → ステータス XP 配分マップ」を廃止)

> **2026-06 改定 (オーナー判断)**: 「クエストの内容 (タグ) に応じて 5 ステータスに XP を
> 配分する」概念 (ステータス XP / `TAG_STAT_MAP` / `statXpDistribution`) は**廃止**した。
> クエストで入るのは**レベルアップ用の経験値だけ**、というオーナーの方針に合わせる。

現仕様: 受託して完了 (発注者が承認) した 1 件あたり **固定 `XP_REWARDS.questComplete` (= 100) XP**
を獲得し、**現職 LV (jobLevel) に加算**する (プレイヤー Lv は #507/#508 で廃止)。タグによる差は無い。

実装は `questXpScalar(receivedQuests, me)` が「完了済み (`status==='completed'`) かつ自分が
受託者 (`assignee===me`) のクエスト数 × 100」を完了集合から派生算出する (`holdings` と同様に
二重加算が原理的に起きない)。表示側 (me / spirit / portfolio) は保存済み XP にこれを足して
レベルを出す。

## 付録 B: Bluesky 自動告知 post の文面テンプレート

クエスト発行時 (`Bluesky にも告知` ON のとき) に生成する post のデフォルトテンプレ。発行画面でユーザーが編集できる。

**発行時 (新規)**:

```
【クエスト】{title}
報酬: {handle}ポイント {rewardPoints} pt
{deadline ? `〆切: ${formatDate(deadline)}` : ''}
{tags.map(t => `#${t}`).join(' ')}
{questUrl}
```

例:

```
【クエスト】精霊のイラストを描いてくれる人募集
報酬: aliceポイント 12000 pt
〆切: 6/15
#illust #art #aozoraquest
https://aozoraquest.app/quests/at://did:plc:.../app.aozoraquest.userQuest/3lp...
```

**通知 post (mention 付き)**: 受託者指定・完了報告・承認等の通知に使う。最小限の 1 行:

```
@{recipient.handle} {action_message}: {questTitle} → {questUrl}
```

例:

```
@sato.bsky.social 受託者に指定されました: 精霊のイラストを描いてくれる人募集 → https://aozoraquest.app/quests/...
```

文面は `packages/core/src/quest-post-template.ts` 等に置き、`prompt-template` の vars 仕様 ([feedback_inference_pipeline](../) と整合) で穴埋めする。

## 参考

- 既存日次クエスト: [`03-game-design.md`](./03-game-design.md#クエスト)
- データスキーマ全般: [`08-data-schema.md`](./08-data-schema.md)
- 共鳴 (相性) システム: [`05-compatibility.md`](./05-compatibility.md)
- admin SPA と directory の運用: [`14-admin.md`](./14-admin.md)
- UI ガイドライン: [`07-ui-design.md`](./07-ui-design.md) / [`../DESIGN.md`](../DESIGN.md)
