# 17. 依頼クエスト ライフサイクル設計 (発行 → 完了まで)

`docs/15-user-quest.md` のデータモデル/集約インフラを前提に、**1 つのクエストが
発行から完了 (or 失敗) まで、各役者が何を見て何ができるか** を状態機械として定義する。
実装が部分的でユーザーが詰む箇所 (例: 受託確定後に受託者からクエストが消える) を
潰すための「正典」とする。

> 前提: 集約 Worker は未デプロイ。発見は **各 PDS を直読みする discovery**
> (`#aozoraquest` 投稿者 + admin directory + 自分) に依存する (docs/15 §集約インフラ,
> および PR #118)。本書はこの「Worker 無し」の現実を前提に設計する。

---

## 0. いま壊れている症状 (このリビジョンで直す対象)

1. **受託確定後、受託者からクエストが消えて何もできない** (最優先)
   - 原因: board のカラム種別に「**自分が受託したクエスト (assigned to me)**」が無い。
     既定カラムは `open` / `mine` のみ。受託確定で status が `open` を外れると `open`
     から消え、`mine` は「自分が発注した」専用なので受託者には出ない。`applied`
     カラムは既定に無く、あっても「応募した全部」で受託専用ビューではない。
   - 結果: 受託者は「完了を報告する」ボタンのある詳細画面へ**到達する導線が無い**。
2. **応募/承認の状態がロールごとに正しく表現されていない**
   - `QuestIndexSummary` に `assignee` が無く、「自分が受託中か」を一覧で判定できない。
   - 落選応募者へのフィードバックが無い (応募一覧から黙って消える)。
3. **status だけでは進行が判定できない** (PR #122 で一部対応済み)
   - 受託者は発注者の record を書けないので `reported` は発注者 PDS に立たない。
     進行状態は **completion record から導出** する必要がある (§2)。

---

## 1. 役者 (Roles)

| 役者 | 定義 |
|---|---|
| **発注者 (owner)** | `quest.did`。クエスト record を持つ PDS の所有者。状態遷移の最終権限を持つ |
| **応募者 (applicant)** | `questApplication` を出した人。複数いうる。受託確定前 |
| **受託者 (assignee)** | `quest.assignee`。発注者が応募者から 1 名選んだ人。`status>=assigned` |
| **落選応募者** | 受託者に選ばれなかった応募者 |
| **第三者 (viewer)** | 上記以外。閲覧のみ |

---

## 2. 状態機械 (Effective State)

### 2.1 record 上の `status` (発注者だけが書ける)

`open → assigned → completed | cancelled`。
**`reported` は発注者 record には事実上書かれない** (受託者が書けないため)。docs/15 の
enum には `reported` があるが、これは「集約 Worker がある世界」での値で、Worker 無しの
現状では発注者 PDS に乗らない。よって status を素朴に信じてはいけない。

### 2.2 completion record (各人が自分の PDS に書く)

- `assigneeReport` … 受託者が「完了しました」(受託者 PDS)
- `requesterApproval` … 発注者が「承認」(発注者 PDS) ← 達成確定 + 報酬発行トリガ
- `requesterRevision` … 発注者が「やり直し依頼」(発注者 PDS)

### 2.3 Effective State (record + completion から計算する唯一の真実)

クライアントは `quest` (発注者 record) と `completions` (owner+assignee 両 PDS) を読み、
**effective state を計算して表示・操作可否を決める**。`isCompleted` / `needsRequesterApproval`
(packages/core/src/user-quest.ts) と同じ「record が真実、status は派生」方針を一般化する。

```
effectiveState(quest, completions):
  if quest.status == 'cancelled'                      -> CANCELLED
  if isCompleted(quest, completions)                  -> COMPLETED   // requesterApproval あり or status=completed
  if quest.assignee 無し:
     if quest.status == 'open' && !expired            -> OPEN
     else                                             -> EXPIRED / CLOSED
  // ここから quest.assignee あり (= 受託確定済み)
  let r = 最新 assigneeReport, v = 最新 requesterRevision
  if r 無し                                            -> IN_PROGRESS        // 受託したが未報告
  if v 有り && v.createdAt > r.createdAt               -> REVISION_REQUESTED // 差し戻し、再報告待ち
  else                                                -> AWAITING_APPROVAL  // 報告済み、承認待ち
```

| Effective State | 意味 |
|---|---|
| `OPEN` | 募集中 (応募受付) |
| `IN_PROGRESS` | 受託確定、受託者が作業中 (未報告) |
| `AWAITING_APPROVAL` | 受託者が完了報告済み、発注者の承認待ち |
| `REVISION_REQUESTED` | 発注者がやり直し依頼、受託者の再報告待ち |
| `COMPLETED` | 承認済み = 達成 (報酬確定) |
| `CANCELLED` / `EXPIRED` | 中止 / 期限切れ |

> **TODO(impl)**: この `effectiveState()` を core に新設し、`needsRequesterApproval`
> もこれの派生にする。board 一覧・詳細・バッジは全部これを基準にする。

---

## 3. 役者 × Effective State の「見える/できる」マトリクス

「見える」= 一覧/詳細に出る、「できる」= 操作ボタンが出る。

| State \ Role | 発注者 | 受託者 | 応募者(未確定) | 落選応募者 | 第三者 |
|---|---|---|---|---|---|
| **OPEN** | 応募者一覧・受託者指定・期限変更・キャンセル | (応募可) | 応募/取り下げ | — | 応募可 |
| **IN_PROGRESS** | 受託者表示・キャンセル(失敗扱い) | **完了報告** ← *導線必須* | 「他の人に決まりました」 | 「選ばれませんでした」 | 受託中表示 |
| **AWAITING_APPROVAL** | **承認 / やり直し依頼** ← *バナーで促す* | 「承認待ち」表示 | 同上 | 同上 | 受託中表示 |
| **REVISION_REQUESTED** | やり直し内容表示 | **再報告** | — | — | 受託中表示 |
| **COMPLETED** | 完了・履歴 | 完了・履歴 (報酬獲得) | 完了表示 | — | 完了表示 |
| **CANCELLED/EXPIRED** | 履歴 | 履歴 | — | — | — |

**太字 = 現状欠けている/弱い導線**:
- 受託者の「完了報告」へ至る一覧ビューが無い (§0-1)。← **本リビジョンの主目的**
- 発注者の「承認待ち」気づき = PR #122 のバナー (completion ベースに修正済)。
- 落選/未確定応募者へのフィードバック表示が無い (応募一覧から消えるだけ)。

---

## 4. 各役者に必要な board ビュー (カラム種別)

現状の filter kind: `open / mine / applied / tag / job / issuer`。
**不足している kind を追加する**:

| kind | 対象 | 既存/新規 | 用途 |
|---|---|---|---|
| `open` | `effectiveState == OPEN` | 既存 | 募集中を探す |
| `mine` | `quest.did == 自分` | 既存 | 発注者が自分の依頼を管理 |
| `applied` | 自分が応募した全 quest | 既存 | 応募者が応募状況を追う |
| **`assigned`** | **`quest.assignee == 自分` かつ未 COMPLETED** | **新規** | **受託者が「自分が受けた仕事」を見て完了報告する** ← §0-1 の修正 |
| `tag`/`job`/`issuer` | 既存 | 既存 | 発見補助 |

### 既定カラム構成 (ロール非依存・全部入り)

ログイン時の board 既定を `[open, assigned, mine, applied]` にする
(現状 `[open, mine]`)。これで「受託した仕事」「応募した仕事」が常に見える。
※ サインインしていない人は `open` のみ。

### 必要なデータ拡張

- `QuestIndexSummary` に **`assignee?` を追加** (toSummary / buildQuestIndexFromDirectory)。
  これが無いと `assigned` フィルタ・effective state を一覧で計算できない。
- `assigned` フィルタは discovery index の quests を `assignee == 自分` で絞る。
  受託者は **発注者の PDS が discovery に乗っていれば** 自分が受託した quest を発見できる
  (発注者は発行時に `#aozoraquest` 投稿済 → 発見可能)。

---

## 5. データの所在と発見 (Worker 無し前提)

| データ | 書く人 | 置き場所 | 他者の読み方 |
|---|---|---|---|
| `userQuest` (本体・status・assignee) | 発注者 | 発注者 PDS | discovery で発注者 PDS を listRecords |
| `questApplication` | 応募者 | 応募者 PDS | discovery + 応募者の #aozoraquest 投稿 (PR #118) |
| `questCompletion` (report/approval/revision) | 各本人 | 各 PDS | `listCompletionsFor` が owner+assignee を直読み |

**受託者が assigned quest を見つける経路**: discovery index の quests (発注者 PDS 由来) を
`assignee==自分` で絞る。発注者は発見可能 (#aozoraquest announcement) なので、受託者は
ログインして board を開けば `assigned` カラムに出る。→ §0-1 解消。

---

## 6. 状態遷移とそのとき起きること (シーケンス)

```
発行     owner: putRecord(userQuest, status=open) + #aozoraquest 告知投稿
応募     applicant: putRecord(questApplication) + #aozoraquest 通知(発見ビーコン, PR#118)
受託確定 owner: putRecord(userQuest, status=assigned, assignee=X) + @X 通知
         → X の board `assigned` カラムに出る (本リビジョンで追加)
完了報告 assignee(X): putRecord(questCompletion role=assigneeReport) + @owner 通知
         → owner の board に「承認待ち」バナー (PR#122, completion ベース)
承認     owner: putRecord(questCompletion role=requesterApproval)
              + putRecord(userQuest, status=completed)   // B: 失敗しても A が真実
              + 報酬ポイント発行
         → 双方 COMPLETED 表示
やり直し owner: putRecord(questCompletion role=requesterRevision) → X が再報告
キャンセル owner: putRecord(userQuest, status=cancelled)
```

---

## 7. 実装タスク (このリビジョンの計画)

優先度順。各々別 PR (CI緑 + §1.5 レビュー)。

1. **core: `effectiveState(quest, completions)` を新設** + テスト。
   `needsRequesterApproval` / `isCompleted` をこれの派生に整理。
2. **`QuestIndexSummary.assignee` 追加** (toSummary / buildQuestIndexFromDirectory) + テスト。
3. **board に `assigned` (受託中) フィルタ追加** + 既定カラムを
   `[open, assigned, mine, applied]` に。受託者が完了報告へ到達できる導線。← **§0-1 解消**
4. **詳細・一覧の状態表示を effectiveState ベースに統一**。
   応募者へ「他の人に決まりました/選ばれませんでした」、受託者へ「作業中/承認待ち/差し戻し」
   を effective state で出す。
5. **動作確認**: 2 アカウントで 発行→応募→受託→報告→(やり直し)→承認→完了 を全部通す。

---

## 8. オーナー判断が要る設計事項 (未決)

1. **受託確定の通知 (`assigned`) も発見ビーコン必須にするか**: 受託者が `assigned` カラムで
   発見するには「発注者の PDS が discovery に乗る」だけで足りる (発注者は #aozoraquest 済)
   ため必須ではない。ただし受託者が即気づくため @mention 通知は欲しい (現状あり)。
2. **落選応募者へのフィードバック粒度**: 「選ばれませんでした」を出すか、黙って applied 一覧で
   状態だけ変えるか。
3. **既定カラムを増やす (`[open, assigned, mine, applied]`)** ことの是非
   (モバイルで横スワイプ枚数が増える)。`assigned` だけ追加で `[open, assigned, mine]` も可。
4. **報酬の二重発行防止**: 承認を 2 回押下/別端末で押した場合のべき等性
   (requesterApproval が既にあれば再発行しない)。

---

本書は `docs/15-user-quest.md` の §状態遷移 / §UI 設計を、Worker 無し現実に合わせて
具体化したもの。実装は本書 §7 の順で進め、各 PR から本書へ追記する。
