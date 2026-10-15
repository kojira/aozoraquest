# 15 - ユーザー発クエスト (依頼掲示板) — 第 1 部 ([目次](./15-user-quest.md))

## 概要

Aozora Quest のユーザー同士が **自分でクエストを発行・受託できる依頼掲示板** 機能。
たとえば「自分の精霊のイラストを描いてくれる人募集」「Rust のコードレビューしてくれる人募集」「散歩仲間募集」のように、ユーザーが他のユーザーへ向けて「やってほしいこと」を投稿し、応募者と組んで完了する。

既存の **日次クエスト (システム自動生成、03-game-design.md)** とは別系統。混同を避けるためコード/UI 上では区別する:

| 種別 | 発行元 | 公開範囲 | 完了判定 | 報酬 | XP |
|---|---|---|---|---|---|
| **デイリークエスト** | システム自動生成 | 本人のみ | 投稿活動を機械判定 | なし | システム付与 |
| **依頼クエスト** (本書) | ユーザー本人 | 公開 / 友達 / 非公開 | 発注者の承認 | **発注者発行の個人ポイント** (発注者ごとに別通貨) | システム付与 (両者) |

## 目的とねらい

- **見るだけ** のアプリから **動く理由** が生まれる: 「賢者の人を探したい」が「賢者の人にクエストを出す」になり、aozoraquest の世界観の中で能動的なコラボが起きる。
- **Bluesky 標準クライアントにない aozoraquest 独自の魅力** を作る。ジョブ・ステータス・目指す姿という RPG 文脈と組み合わせると、TweetDeck 的な汎用掲示板にはならない固有の意味が出る。
- **マルチカラム機能** (将来) と組み合わせると、「募集中のクエスト」「自分の発行したクエスト」「自分が応募中のクエスト」を並べて見られる。

## 用語

| 用語 | 意味 |
|---|---|
| **依頼クエスト (User Quest)** | ユーザーが発行する公開タスク。本書の主題 |
| **発注者 (Requester)** | クエストを発行する側 |
| **応募 (Application)** | 受託意思を表明する書き込み |
| **応募者 (Applicant)** | 応募した側 |
| **受託者 (Assignee)** | 応募者の中から発注者が選んで合意した人 |
| **完了報告 (Report)** | 受託者が「終わりました」を発注者に通知する書き込み |
| **承認 (Approval)** | 発注者が完了報告を受け入れる行為。この時点で報酬移動 + XP 付与が確定する |
| **個人ポイント (Personal Point)** | aozoraquest の通貨は **発注者ごとに別通貨**。alice が出すクエストの報酬は「aliceポイント」、sato が出すなら「satoポイント」。内部識別子は発注者の DID。**ポイントは合算されず、種類別に独立で保持・表示する**。実装上は整数 |
| **持ち主表記** | 表示名は「<handle>ポイント」(例「aliceポイント」)。handle は Bluesky 側で変更され得るので、内部キーは常に DID |
| **報酬価格** | 発注者は自分のクエストにつき任意の数を指定できる (例: 「claudeポイント 500」「aliceポイント 12000」)。**発行上限は設けない**。価値は発注者の信用に依存し、「割に合わない」と感じた応募者が応募しないことで市場原理的に均衡する |
| **新規ユーザーの不利と bootstrap** | **正直に書くと**: 個人発行通貨は信用が事後的につくため、新規ユーザーの発行ポイントには初期は需要がない。「動かなさ」を前提に、対策として:<br>(a) システム XP は誰でも均等に得られるので、最初は「ポイントは将来の信用残高、まずは XP で動こう」と UI で誘導<br>(b) 完了 N 件で「ポイント+1」のような bootstrap 補助 (Phase 5+ で検討)。**正直に書くと**: これは「誰が発行するか」が未解決で、システム発行にすると「個人発行通貨」原則を壊す。本人が自分のポイントを自動 mint するのは「上限なし」を超えるものではない。妥協案は「受託者の所持ポイント残高に応じて、応募時に発注者が指定した報酬量に最低保証を加算」だが MVP では実装しない<br>(c) 既存信用者 (= 有名ユーザー) のポイントは受け取り手が多いので、新規ユーザーは最初は「有名ユーザーのクエストに応募」で信用を獲得し、自分発行に進む二段ロケットを誘導<br>(d) `aliceポイント` 等のインフレが進んだら相対指標 (= シェア%) で価値が伝わる仕組みは既に組み込んでいる<br>これは設計の限界であって、市場原理だけで均衡する保証はないことを明示しておく |

## ユーザーストーリー

### 発注者側

1. アプリ右上から「クエストを出す」を選ぶ
2. タイトル・本文・タグ・**報酬ポイント (= 自分の名前のポイントを N pt)**・公開範囲・締切 (任意) を入力 → 公開
3. クエストが公開リストに載る (オプションで Bluesky にも告知 post を同時生成)
4. 応募が来たら通知を受け取り、応募者リストから 1 名を受託者に指定
5. やり取りは aozoraquest 内コメント or Bluesky DM で進める
6. 受託者から完了報告が届いたら、内容を確認して「承認」または「やり直しを依頼」
7. 承認した瞬間に **発注者発行ポイントが受託者の所持に N pt 加算** + XP がシステムから両者に付与される (発注者は自分のポイントを発行するだけで、自分の所持は減らない)

### 応募者側

1. 募集中のクエスト一覧からタグやジョブで絞り込む。各クエストには「aliceポイント 12000」のように発注者ごとの単位で報酬が示される
2. 自分にとってその発注者のポイントに価値があるか判断 (= 過去の発注実績・信用) して応募コメントを投稿
3. 発注者から「受託者に指定」されたら通知が来る
4. やり取りして作業
5. 終わったら「完了報告」をマーク + 成果物リンクや一言コメントを添える
6. 発注者の承認が下りたら、その発注者の名前のポイント + 共通 XP が入る (例: 「aliceポイント +12000」)
7. やり直し指示が来たら作業を続けて再度報告

### 横断ストーリー

- フォロワーが何のクエストを出しているか TL 的に追える
- 「目指す姿: 賢者」のユーザーは賢者ジョブの応募者を優先的にハイライト
- 過去に協力した相手の履歴が残り、相性スコアに微加点 (将来)

## データモデル

新規 NSID は AT Protocol PDS 上に置く。アプリは DB を持たない (既存方針)。

### NSID 命名と既存スキーマとの関係

`app.aozoraquest.*` の名前空間で、本書で追加する NSID と既存の NSID を整理する:

| NSID | 場所 (誰の PDS) | rkey | 役割 | 出典 |
|---|---|---|---|---|
| `app.aozoraquest.profile` | 各ユーザー | `self` | 目標ジョブ・設定 | 08-data-schema |
| `app.aozoraquest.analysis` | 各ユーザー | `self` | 気質診断結果 | 08-data-schema |
| `app.aozoraquest.questLog` | 各ユーザー | tid | **システム日次クエストの進捗履歴** (本書とは別物) | 03-game-design, 08-data-schema |
| `app.aozoraquest.companion` / `companionLog` | 各ユーザー | `self` / tid | 精霊機能 | 08-data-schema |
| `app.aozoraquest.directory` | 主管理者のみ | `self` | 共鳴 TL の opt-in DID リスト (手動運用) | 05-compatibility, 14-admin |
| **`app.aozoraquest.userQuest`** | 発注者 | tid | **本書: 依頼クエスト本体** | 本書 |
| **`app.aozoraquest.questApplication`** | 応募者 | tid | **本書: 応募** | 本書 |
| **`app.aozoraquest.questCompletion`** | 発注者 or 受託者 | tid | **本書: 完了報告 / 承認 / やり直し** | 本書 |
| **`app.aozoraquest.questIndex`** | 主管理者のみ | `self` | **本書: 公開クエスト + 応募インデックス (Worker 自動運用)** | 本書 |
| `app.aozoraquest.questReport` (将来) | 通報者 | tid | 通報 | 本書 Phase 4 |

**`questLog` (システム日次) と `userQuest` (本書) は別物**。前者はユーザーがその日にクリアしたシステム発行クエスト記録、後者はユーザー発行の依頼掲示板アイテム。混同回避のため、本書系統はすべて `quest*` (Application / Completion / Index / Report) で命名統一する。

`08-data-schema.md` の表にも本書の 4 NSID を Phase 1 の実装と同時に追記する。

### app.aozoraquest.userQuest

依頼クエスト本体。`rkey` はタイムスタンプベース (`tid`)。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.userQuest",
  "defs": {
    "main": {
      "type": "record",
      "description": "A user-issued quest seeking applicants from other users.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["title", "body", "status", "visibility", "createdAt"],
        "properties": {
          "title":       { "type": "string", "maxGraphemes": 80, "maxLength": 240 },
          "body":        { "type": "string", "maxGraphemes": 1500, "maxLength": 6000 },
          "tags":        { "type": "array", "maxLength": 8, "items": { "type": "string", "maxLength": 32 } },
          "targetJob":   { "type": "string", "description": "応募者に求めるジョブ (任意)", "knownValues": ["sage","mage","shogun","bard","seer","poet","paladin","explorer","warrior","guardian","fighter","artist","captain","miko","ninja","performer"] },
          "deadline":    { "type": "string", "format": "datetime", "description": "募集期限 (任意)。期限内のものを有効と扱う。発注者は途中で延長/短縮できる。期限超過で自動キャンセルにはせず、発注者の明示操作のみが status を変える" },
          "visibility":  { "type": "string", "knownValues": ["public"], "default": "public", "description": "MVP は public のみ。将来の互換のためフィールド自体は残す" },
          "status":      { "type": "string", "knownValues": ["open", "assigned", "reported", "completed", "cancelled"], "default": "open" },
          "assignee":    { "type": "string", "format": "did", "description": "受託者 DID (status=assigned 以降)" },
          "rewardPoints": { "type": "integer", "minimum": 0, "description": "報酬として発注者が自分のポイントを N pt 発行する。通貨は『発注者 DID のポイント』。上限なし" },
          "blueskyPostUri": { "type": "string", "format": "at-uri", "description": "Bluesky 告知 post を生やした場合の uri (任意)" },
          "createdAt":   { "type": "string", "format": "datetime" },
          "updatedAt":   { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

**ポイント**:
- `rkey = tid` で時系列ソート可能。`getRecord` で読み出せる
- `visibility` の権限制御はクライアント側でフィルタ (AT Proto は record 単位のアクセス制御を持たない。`private` はクライアントで隠すだけで、技術的には誰でも読める前提で運用)
- `assignee` を field として持つことで、受託状態を 1 record で表現する。複数応募者管理は別 record (下記 `questApplication`)
- `rewardPoints` は発注者発行の整数 pt。報酬は **金銭以外** に限定 (モデレーション複雑化と法的責任を避けるため)
- **ポイントの通貨種類はこの record の owner DID で識別する**。`rewardPoints: 12000` の record が `did:plc:alice...` の PDS にあれば「alice ポイント 12000」を意味する

### app.aozoraquest.questApplication

応募レコード。`rkey` はタイムスタンプ。応募者の PDS に書く。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.questApplication",
  "defs": {
    "main": {
      "type": "record",
      "description": "An application to a user-issued quest.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["questUri", "message", "createdAt"],
        "properties": {
          "questUri": { "type": "string", "format": "at-uri", "description": "対象クエスト (app.aozoraquest.userQuest) の uri" },
          "message":  { "type": "string", "maxGraphemes": 500, "maxLength": 2000 },
          "withdrawn": { "type": "boolean", "default": false },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

**ポイント**:
- 応募は応募者の PDS にあるので、依頼者は応募者一覧をクエスト詳細画面で集約取得する (= aozoraquest が複数 PDS から `listRecords` で集めて表示)
- 取り下げは `withdrawn: true` でソフト削除。レコード自体は残す (改ざん監視のため)

### app.aozoraquest.questCompletion

完了の進行レコード。受託者の **完了報告** と発注者の **承認 / やり直し** を表現する。最終的な「承認」が書かれた瞬間にポイント発行 + XP 付与が確定する。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.questCompletion",
  "defs": {
    "main": {
      "type": "record",
      "description": "Step in the completion flow: assigneeReport, requesterApproval, or requesterRevision.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["questUri", "role", "createdAt"],
        "properties": {
          "questUri": { "type": "string", "format": "at-uri" },
          "role":     {
            "type": "string",
            "knownValues": ["assigneeReport", "requesterApproval", "requesterRevision"],
            "description": "assigneeReport=受託者の完了報告、requesterApproval=発注者承認 (確定)、requesterRevision=発注者がやり直しを依頼"
          },
          "rating":   { "type": "integer", "minimum": 1, "maximum": 5, "description": "相手への評価 (任意、将来用)" },
          "comment":  { "type": "string", "maxGraphemes": 300, "maxLength": 1200 },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

**ポイント**:
- **発注者承認のみで完了確定** (= ポイント発行 + XP 付与のトリガ)。「受託者報告」は承認待ち状態に遷移させる材料
- `assigneeReport` は受託者の PDS に書かれる。`requesterApproval` / `requesterRevision` は発注者の PDS に書かれる
- **発行ポイントは元クエストの `rewardPoints` で固定**。承認時に増減はできない (= 透明性重視)。受託者は応募時点で確定額を見て応募する
- `rating` は MVP では未使用、将来の評価機能用のフィールドだけ用意

### app.aozoraquest.questIndex (集約インデックス、主管理者 PDS のみ)

公開クエストと応募の **発見性** を確保するためのインデックス。主管理者 (`VITE_ADMIN_DIDS` 先頭) の PDS の `rkey=self` シングルトンとして置く。**この record は Cloudflare Worker が書き込み、各クライアントは read のみ行う**。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.questIndex",
  "defs": {
    "main": {
      "type": "record",
      "description": "Index of public user quests and applications, maintained by the aozoraquest backend Worker.",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["quests", "applications", "updatedAt"],
        "properties": {
          "quests": {
            "type": "array",
            "description": "公開クエストの at-uri と最小サマリ",
            "items": {
              "type": "object",
              "required": ["uri", "did", "title", "rewardPoints", "status", "createdAt"],
              "properties": {
                "uri":          { "type": "string", "format": "at-uri" },
                "did":          { "type": "string", "description": "発注者 DID" },
                "title":        { "type": "string", "maxLength": 240 },
                "tags":         { "type": "array", "items": { "type": "string" } },
                "rewardPoints": { "type": "integer" },
                "deadline":     { "type": "string", "format": "datetime" },
                "status":       { "type": "string" },
                "createdAt":    { "type": "string", "format": "datetime" }
              }
            }
          },
          "applications": {
            "type": "array",
            "description": "応募の at-uri と所属 quest の対応",
            "items": {
              "type": "object",
              "required": ["uri", "did", "questUri", "createdAt"],
              "properties": {
                "uri":       { "type": "string", "format": "at-uri" },
                "did":       { "type": "string", "description": "応募者 DID" },
                "questUri":  { "type": "string", "format": "at-uri" },
                "createdAt": { "type": "string", "format": "datetime" }
              }
            }
          },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

**ポイント**:
- 最小サマリのみ保持。本文 / 詳細は各クエスト原本 PDS から resolve する
- 大きくなったら quests / applications を別 rkey に分割するページング設計を Phase 3 で検討
- Worker が落ちたとしても各原本 PDS は無事なので、復旧時に再構築できる (= eventual consistency)

### app.aozoraquest.questReport (将来)

通報レコード。MVP では未実装、Phase 4 で導入。

## ライフサイクル

```
                  発行         応募         受託者指定       完了報告
   ┌────────┐ ──────► ┌──────┐ ─────► ┌────────────┐ ──────► ┌──────────┐
   │ draft  │         │ open │        │  assigned  │         │ reported │
   │(UI のみ)│         └──────┘        └────────────┘         └──────────┘
   └────────┘            │   ▲             │                     │   │
                         │   │             │                     │   │ やり直し
                         │   │             ▼                     │   ▼
                         │   │       (応募者と DM/コメント)         │  (assigned に戻る)
                         │   │                                   │
                         │   │                                   │ 承認
                         ▼   │ 発注者が明示キャンセル                ▼
                    ┌──────────┐                          ┌─────────────┐
                    │ cancelled│ ◄────────────────────    │  completed  │
                    └──────────┘                          └─────────────┘
                                                         ※ ポイント発行 + XP 付与は
                                                            ここで確定
```

- `open`: 応募受付中
- `assigned`: 発注者が受託者を指定 (応募者追加は不可)
- `reported`: 受託者が完了報告 (`assigneeReport`) を出した。発注者の承認待ち
- `completed`: 発注者が承認 (`requesterApproval`)。**この時点でポイントと XP が確定する**
- `cancelled`: 発注者の明示キャンセル

`reported` 状態で発注者が `requesterRevision` を書くと `assigned` に戻り、受託者が再度作業 → 再報告する。

### 募集期限と失効の扱い

aozoraquest は DB / サーバ cron を持たない pure SPA + PDS 構成のため、**自動失効は実装しない**。代わりに以下の運用にする:

- 発注者は `deadline` (募集期限) を発行時に **任意で設定可能**。期限を入れなくてもいい
- **期限内のクエストのみ「有効 (= 応募受付可)」と扱う**
- 期限超過 = UI 上で「期限切れ」と表示し、応募ボタンを無効化する。schema 上の `status` は触らない (= `open` のまま残る)
- 発注者は **後から `deadline` を延長 / 短縮できる**。延長すれば即「有効」に戻る
- 「もう要らない」ときは発注者が明示的に `status=cancelled` にする。ステータスを変える唯一のトリガは発注者の操作のみ

実装的には「失効中」は computed (`deadline < now && status === 'open'`) で判定するため、新しい status enum 値は追加しない。

**放置 quest 堆積への対策** (= レビューで指摘された問題、リリース前):
- 一覧 (`/board`「募集中」カラム) は **デフォルトで「期限切れを除く」フィルタを ON**。「全て表示」を opt-in で
- questIndex の容量に近づいたら、Worker 側で **期限切れ + 30 日以上動きなし** のクエストを index から落とす (原本 PDS の record は触らない)
- 一覧の表示は **createdAt 降順 + 期限切れを下に寄せる**
- 既存ユーザーの「自分が出した」タブには status `open` 期限切れの quest をハイライトして「キャンセル or 期限延長を促す」UI を出す
- 期限超過 90 日でクライアント側で「自動アーカイブ提案」モーダルを出す (発注者が明示キャンセルを選ぶフロー)

## 集約インフラ (発見性をどう確保するか)

AT Proto には逆引き API がないため、「公開クエスト一覧」「応募者一覧」を素朴に取る方法がない。aozoraquest は DB を持たない方針なので、**主管理者の PDS に集約 record を置き、Cloudflare Worker がその書き込みを担う** ハイブリッド方式を採る。

### 構成

```
   ┌─────────────────┐     POST /index/quest         ┌──────────────────┐
   │ クライアント      │ ───────────────────────────►  │ Cloudflare Worker│
   │ (発注/応募 直後)  │                              │  (aozoraquest    │
   └─────────────────┘                               │   backend)       │
            │                                        │                  │
            │ 原本 PUT (自分の PDS)                   │  └──┐             │
            ▼                                        │     │             │
   ┌─────────────────┐                               │     ▼             │
   │ ユーザー PDS     │ ◄── 検証 fetch (公開 read)──── │  putRecord       │
   │ userQuest /     │                               │  app.aozoraquest │
   │ questApplication│                               │  .questIndex     │
   └─────────────────┘                               │  on admin PDS    │
                                                     └──────────────────┘
                                                              │
                                                              ▼
                                                     ┌──────────────────┐
                                                     │ 主管理者 PDS      │
                                                     │ (alice)         │
                                                     │  questIndex/self │
                                                     └──────────────────┘
                                                              ▲
                                                              │ getRecord (誰でも公開 read)
                                                              │
                                                ┌─────────────────────────┐
                                                │ 他クライアント (一覧表示) │
                                                └─────────────────────────┘
```

### 役割分担

| 主体 | 責務 |
|---|---|
| **クライアント (発注/応募 直後)** | 原本を自分の PDS に PUT した後、Worker に「URI + 最小サマリ」を POST する。失敗時はバックグラウンドでリトライ |
| **Cloudflare Worker** | (a) クライアントからの POST を受ける、(b) その URI が本当に存在するか発注者 PDS に検証 fetch する、(c) 主管理者 PDS の `app.aozoraquest.questIndex` を `putRecord` で更新する |
| **主管理者 PDS (alice)** | インデックス本体を保持。公開 read 可能なので、全クライアントが認証なしで取得できる |
| **他クライアント** | 一覧画面表示時に管理者 PDS から questIndex を読む。詳細表示時は各 quest 原本 PDS から fetch |

### 認証 (検証済み: 2026-06-05)

**Worker → 主管理者 PDS**: AT Protocol OAuth の **confidential client** として実装する。

仕様・ライブラリ両面で実装可能であることを確認済み:

- AT Proto OAuth spec ([atproto.com/specs/oauth](https://atproto.com/specs/oauth)) に confidential client が定義されている
- 公式ライブラリ `@atproto/oauth-client-node` が `token_endpoint_auth_method: 'private_key_jwt'` + `dpop_bound_access_tokens: true` + sessionStore インタフェースをフルサポート
- **confidential client のセッション寿命は 2 年、refresh は 3 ヶ月** (`@atproto/oauth-provider/src/constants.ts`)。public client (2 週間) と違い、現実的な長期運用が可能

必要な準備:

1. **ES256 鍵ペア生成** (NIST P-256)。秘密鍵は Cloudflare Worker secret として保管 (=「Bindings → Secrets」に PEM 文字列で投入)
2. **client-metadata.json を `https://aozoraquest.app/oauth/quest-worker/client-metadata.json` で公開**。中身は `token_endpoint_auth_method: 'private_key_jwt'`, `dpop_bound_access_tokens: true`, `jwks_uri`, `redirect_uris: ['https://aozoraquest.app/oauth/quest-worker/callback']` 等
3. **JWKS エンドポイント `https://aozoraquest.app/oauth/quest-worker/jwks.json`** で公開鍵を配信 (鍵ローテーション対応)
4. **alice が初回 1 回だけブラウザで認可フローを完遂** → 取得した refresh token (3 ヶ月寿命) を Worker の sessionStore (Cloudflare KV) に永続化
5. Worker の **Cron Trigger (1 日 1 回)** で refresh token を更新。session 失効間近 (例: 残り 7 日) でアラート

既存 `apps/admin` の OAuth client_id とは別 client_id にする (admin SPA は public client、quest Worker は confidential client、混在不可)。

**単一障害点の緩和** (= リリース前に潰すべき運用課題): 上の構成では Worker → 主管理者 PDS (alice) の 1 本に全機能が紐づいており、alice アカウント停止 / PDS 障害 / refresh token 失効が全機能停止に直結する。緩和策として:

1. **`VITE_ADMIN_DIDS` を複数登録** (例: `did:plc:alice,did:plc:sub1,did:plc:sub2`)。Worker は順に各 DID の confidential client session を持っておき、書き込み時に最初の `available` な PDS に index を書く
2. クライアントは read 時に **登録された admin DID 順に questIndex を取り、最初に取れたものを採用**。同じ rkey が複数 admin にあれば updatedAt 新しい方を採用
3. **再構築ツール**: index が壊れた / 別 admin に切替えた直後は、Worker が `app.aozoraquest.userQuest` を発見できる範囲で listRecords → 各 admin に再書き込み

これによりリーダー / フォロワー的な多重化が成立し、alice が消えても新しい admin が引き継げる。Phase 1 段階では admin 1 名で OK だが、index レキシコンと Worker 実装は「複数 admin 想定の I/F」で書いておくこと。

**split-brain と書き手競合の解決ルール** (= 第三者レビューで指摘):
- **書き手の選択順** は `VITE_ADMIN_DIDS` の配列順 (先頭が primary)。Worker は primary から順に「session が valid」「直近 60 秒で書き込み成功した記録あり」を満たす最初の admin に書く
- 「session が valid」= refresh token の残寿命が 24h 以上、かつ直近の token refresh が成功している
- **読み手の選択**: クライアントは全 admin の `questIndex/<env>` を並列 fetch し、`updatedAt` 新しい方を採用。完全に同時刻 (= ミリ秒同値) なら primary を優先
- **同 rkey へ複数 admin が同時書きしたケース** (= split-brain) は、Worker の **次回起動時** に再構築ツールが走り、各 admin が書いた index を見て差分を統合 (= 全 admin の差集合を取って primary に書き戻す + 他 admin の index を primary 内容に上書き)
- ただし MVP 段階では admin 1 名なので split-brain は構造的に発生しない。複数 admin が混在するときは再構築ツールが必須前提

**Cloudflare Workers 動作確認 (PoC 2026-06-05 実施)**: `@atproto/oauth-client-node` を `nodejs_compat` 付き Workers にロードすると **import 評価で失敗** することが確定。原因は内部依存 `undici` が `process.env.NODE_DEBUG.split(',')` を初期化時に評価するため、Workers の polyfill では `undefined.split` で死ぬ。`@atproto-labs/fetch-node` 自体も `https.Agent` 依存で Workers 互換ではない。

そのため、**Workers では `@atproto/oauth-client` (core) を直接使い、Node 依存部分を Web Crypto Subtle + Web 標準 `fetch` で自前 adapter として書く** ルートを採る:

- 鍵管理: Web Crypto SubtleCrypto (`importKey('jwk', ...)`, `sign('ECDSA', ...)`) で ES256
- JWT 署名: `private_key_jwt` 用 `client_assertion` を自前で組み立て
- DPoP: Web Crypto で都度署名
- セッション永続化: Cloudflare KV (or Durable Objects)
- HTTP: Workers ネイティブの `fetch` を使う Runtime adapter

実装量は増えるが、仕様 (`atproto.com/specs/oauth`) は明確で、参照実装 (`@atproto/oauth-client-node` のソース) を読みながら Workers ネイティブ化していく。`apps/edge/src/oauth-probe.ts` で PoC の足跡を残してある。

**クライアント → Worker** の認証は **クライアント自身の Bluesky access token を Bearer で送り**、Worker が AppView 経由で `getSession` を呼び本人検証する。これで「他人のクエストを勝手に index に乗せる」を防ぐ。

### 冪等性と整合性

- Worker は受け取った URI が既に index にあれば idempotent に skip
- 完了 / キャンセル等で status が変わったら、クライアントが再度 POST する。Worker は上書き
- 検証 fetch (= 発注者 PDS の record が本当に存在し、要求された URI と一致するか) を必ず通す。これで「存在しない URI を捏造して index 汚染」を防ぐ
- インデックス書き込みは **eventual consistency** で OK。「クエストを出した瞬間に他人の一覧に出る」必要はない (= 数秒〜数分の遅延を許容)
- index が壊れた場合の **再構築手段** を別途用意: Worker が `app.aozoraquest.userQuest` を発見できる全ユーザーから fetch して再生成 (Phase 3 以降の運用ツール)。MVP では手動再構築で可

### スパムとレート制限

- 同一 IP / 同一 DID からの POST にはレート制限 (例: 1 分 5 件) を Cloudflare Worker レベルで掛ける
- index にはサイズ上限を設ける (例: quests 5000 件まで)。超えたら最古を切る or ページング rkey に移行
- 検証 fetch 失敗時は登録しない

### 既存 admin directory との関係

主管理者 PDS には既に `app.aozoraquest.directory` (`05-compatibility.md` / `14-admin.md`) があり、共鳴 TL の opt-in DID リストを保持している。`questIndex` は **その隣に並ぶ新規シングルトン**。directory は手動運用 (admin SPA から)、questIndex は Worker 自動運用、と書き込み主体が違うだけ。

将来この 2 つ + 他のインデックスを統合した「aozoraquest 機能間の共通 admin PDS」を整理する余地はあるが、本書のスコープ外。

### MVP / Phase 別の落とし方

- **Phase 1**: クエスト発行のみ。Worker は POST 受付 + 検証 + putRecord。一覧 read はクライアントが直接 questIndex から。応募はまだないので applications フィールドは空でも OK
- **Phase 2**: 応募と完了。Worker に `/index/application` エンドポイント追加。受託者指定 (assignee 更新) のときも quest の status を index に反映
- **Phase 3**: ページング rkey、再構築ツール、Worker → Bluesky 通知 post の生成も Worker に寄せる検討

### 耐故障性 (完了時の複数 write)

承認 (`requesterApproval`) の操作は **次の 4 ステップ** が連鎖して発生する。1 トランザクションにはできないため、**「(A) が真実、(B-D) は派生」** という原則で扱う:

| 順 | 操作 | 場所 | 必須? | 失敗時 |
|---|---|---|---|---|
| A | `requesterApproval` record を PUT | 発注者 PDS | **真実の源** | 全体失敗、UI はエラー表示してリトライ促す |
| B | 元 quest record の `status=completed` 更新 | 発注者 PDS | 推奨 | A だけ残れば集計は computed で `completed` 扱い可能。次回ログイン時にバックグラウンド reconcile |
| C | Worker に再 POST して `questIndex` 同期 | Worker → 主管理者 PDS | 推奨 | 失敗時クライアントが指数バックオフでリトライ。最終的に Worker 側 cron で reconcile |
| D | Bluesky 通知 post を生成 (受託者宛 mention) | 発注者 PDS (or Worker) | best-effort | 失敗しても black swan。aozoraquest 内通知バッジは A が真なら立つ |

**集計時の真実**: 「completed か?」の判定は **owner DID check 込み** の次の computed ルール:
```ts
const isCompleted = (q: UserQuest, approvals: QuestCompletion[]) =>
  q.status === 'completed' ||
  approvals.some(a =>
    a.questUri === q.uri &&
    a.role === 'requesterApproval' &&
    a.did === q.did  // ★ approval の owner DID が発注者本人であること
  );
```
これにより、B が遅延しても A さえあれば「完了」と認識される。ポイント発行・XP 付与の computed も同じ判定を使う (= B には依存しない)。

**owner DID 検証は必須** (= リリース前に潰すべきセキュリティホール): AT Proto では誰でも自分の PDS に同名 record を書けるため、`role === 'requesterApproval'` だけで判定すると、第三者が「対象 quest URI + role=requesterApproval」の record を自 PDS に PUT するだけで偽造完了が成立する。`assigneeReport` も同様で、書き手 DID = `q.assignee` のチェックが要る。core/user-quest.ts では `isValidCompletion(c, q)` ヘルパを提供しているので、集計や表示前に必ず通すこと。

**reconciliation ジョブ** (= 実装方針):
- 各クライアントは起動時に「自分の `requesterApproval` を全部走査し、対応する quest の `status` が `completed` でなければ更新」を行う。これで B の欠落を自動修復する
- 実装場所: `quest-api.ts` の `reconcileMyApprovals(agent, did)` 関数として用意し、`/me` または `/me/portfolio` を最初に開いたタイミングで実行する (= ユーザーの能動的なアクションを邪魔しない位置)
- 副作用: 各 reconciliation 中も `mockIndex` / Worker への notify を呼んで eventual consistency を担保
- 一度実行したら 24h は走らせない (= localStorage の `aozoraquest:lastReconcileAt` で記録)

これにより EDGE モードでも同 quest の `status` が最終的に整合する。Phase 2 着手と同時に実装すること (= Phase 2 で approve/revision が始まるまでは reconciliation 対象が無い)。

### 想定する代表エラーと挙動

| エラー | 検知方法 | 挙動 |
|---|---|---|
| Worker タイムアウト (= index 同期失敗) | POST が 5xx / timeout | クライアントは原本 record は既に書けているので「成功」扱い。バックグラウンド queue に積んで指数バックオフリトライ |
| 認証期限切れ (= Bluesky session expired) | 既存の signed-out フローに乗る | session.ts が `signed-out` に倒す、UI は再ログインを促す |
| 検証 fetch で record 不一致 | Worker が 4xx 返す | クライアントが原本 PDS との不整合を再検出。typically race condition、ユーザーには「もう一度試してください」 |
| index の record サイズ上限到達 | putRecord が 400 | Worker が最古を切る or ページング rkey に切替 (Phase 3 で実装、MVP では切替なし) |
| 主管理者の refresh token 失効 | Worker cron が refresh に失敗 | alice に DM / Slack で通知。alice が手動再ログインで復旧 |

