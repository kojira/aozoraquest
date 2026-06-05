# 15 - ユーザー発クエスト (依頼掲示板)

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
| **個人ポイント (Personal Point)** | aozoraquest の通貨は **発注者ごとに別通貨**。kojira が出すクエストの報酬は「kojiraポイント」、sato が出すなら「satoポイント」。内部識別子は発注者の DID。**ポイントは合算されず、種類別に独立で保持・表示する**。実装上は整数 |
| **持ち主表記** | 表示名は「<handle>ポイント」(例「kojiraポイント」)。handle は Bluesky 側で変更され得るので、内部キーは常に DID |
| **報酬価格** | 発注者は自分のクエストにつき任意の数を指定できる (例: 「claudeポイント 500」「kojiraポイント 12000」)。**発行上限は設けない**。価値は発注者の信用に依存し、「割に合わない」と感じた応募者が応募しないことで市場原理的に均衡する |

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

1. 募集中のクエスト一覧からタグやジョブで絞り込む。各クエストには「kojiraポイント 12000」のように発注者ごとの単位で報酬が示される
2. 自分にとってその発注者のポイントに価値があるか判断 (= 過去の発注実績・信用) して応募コメントを投稿
3. 発注者から「受託者に指定」されたら通知が来る
4. やり取りして作業
5. 終わったら「完了報告」をマーク + 成果物リンクや一言コメントを添える
6. 発注者の承認が下りたら、その発注者の名前のポイント + 共通 XP が入る (例: 「kojiraポイント +12000」)
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
- **ポイントの通貨種類はこの record の owner DID で識別する**。`rewardPoints: 12000` の record が `did:plc:kojira...` の PDS にあれば「kojira ポイント 12000」を意味する

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
                                                     │ (kojira)         │
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
| **主管理者 PDS (kojira)** | インデックス本体を保持。公開 read 可能なので、全クライアントが認証なしで取得できる |
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
4. **kojira が初回 1 回だけブラウザで認可フローを完遂** → 取得した refresh token (3 ヶ月寿命) を Worker の sessionStore (Cloudflare KV) に永続化
5. Worker の **Cron Trigger (1 日 1 回)** で refresh token を更新。session 失効間近 (例: 残り 7 日) でアラート

既存 `apps/admin` の OAuth client_id とは別 client_id にする (admin SPA は public client、quest Worker は confidential client、混在不可)。

**Cloudflare Workers 動作確認**: `@atproto/oauth-client-node` は Node.js 想定だが、Workers の `nodejs_compat` flag + `wrangler.toml` で動く想定。**Phase 1 着手時の最初の PoC でこの組み合わせを実機検証する**。動かなければ Web Crypto Subtle で JWT 署名 + DPoP を手書きする代替ルートに切り替える (実装量増えるが仕様準拠で動かせる)。Workers がどうしても無理なら Cloudflare Pages Functions または別ホスト (Fly.io 等) で Node ランタイムに逃げる選択肢もある。

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

**集計時の真実**: 「completed か?」の判定は **次の computed ルール**:
```ts
const isCompleted = (q: UserQuest, approvals: QuestCompletion[]) =>
  q.status === 'completed' ||
  approvals.some(a => a.questUri === q.uri && a.role === 'requesterApproval');
```
これにより、B が遅延しても A さえあれば「完了」と認識される。ポイント発行・XP 付与の computed も同じ判定を使う (= B には依存しない)。

**reconciliation ジョブ**: 各クライアントは起動時に「自分の `requesterApproval` を全部走査し、対応する quest の `status` が `completed` でなければ更新」を行う。これで B の欠落を自動修復する。発注: 同 quest の `status` も最終的に整合する。

### 想定する代表エラーと挙動

| エラー | 検知方法 | 挙動 |
|---|---|---|
| Worker タイムアウト (= index 同期失敗) | POST が 5xx / timeout | クライアントは原本 record は既に書けているので「成功」扱い。バックグラウンド queue に積んで指数バックオフリトライ |
| 認証期限切れ (= Bluesky session expired) | 既存の signed-out フローに乗る | session.ts が `signed-out` に倒す、UI は再ログインを促す |
| 検証 fetch で record 不一致 | Worker が 4xx 返す | クライアントが原本 PDS との不整合を再検出。typically race condition、ユーザーには「もう一度試してください」 |
| index の record サイズ上限到達 | putRecord が 400 | Worker が最古を切る or ページング rkey に切替 (Phase 3 で実装、MVP では切替なし) |
| 主管理者の refresh token 失効 | Worker cron が refresh に失敗 | kojira に DM / Slack で通知。kojira が手動再ログインで復旧 |

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
- 各カードに: タイトル、発注者の avatar+job バッジ、本文冒頭 100 字、tag chip、応募数、締切までの残日数、**報酬表記** (例: `kojira ⓟ 12000`)

### C. クエスト詳細 (`/quests/:uri`)

- ヘッダー: 発注者の avatar + handle + ジョブバッジ + LV + 報酬ポイント (`kojiraポイント 12000`)
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

- 一覧 (新しい順): タイトル / 発注者 avatar+handle / 状態 / 完了日 / 獲得ポイント (例: `kojiraポイント +12000`) / 自分の成果物リンク
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
  - **何人に発行したか** (= 完了時に報酬を渡したユニーク受取人 DID 数): 例「47 件のクエスト完了で、12 人に kojira ポイントを発行」
  - **累計発行ポイント** (= 自分発行ポイントの総流通量): 例 `kojiraポイント 累計発行 152,000 pt / 47 件`
  - 発行頻度の推移 (月別グラフ、Phase 3+)

「失敗」と「キャンセル」の区別は **assignee 指定の有無** で機械判定する。schema 上のステータスは `cancelled` 1 種で持ち、UI 側で分類して表示する。意図的に別 status を立てないのは、Phase 1 のスコープを膨らませないため。

#### ポイント保有状況

自分が持っている **他人発行ポイント** を種類別に一覧:

```
🏅 保有ポイントランキング (発行者別)

1.  kojiraポイント    18,400 pt   (kojira 総発行 152,000 中、シェア 12.1%)
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

// 「sato が持つ kojira ポイント」: kojira の completed quest のうち assignee=sato
const holdings = (issuerQuests: UserQuest[], me: Did) =>
  issuerQuests
    .filter(q => q.status === 'completed' && q.assignee === me)
    .reduce((sum, q) => sum + (q.rewardPoints ?? 0), 0);

// 「kojira の総発行 (= 発行ポイント流通量)」
const totalIssued = (issuerQuests: UserQuest[]) =>
  issuerQuests
    .filter(q => q.status === 'completed')
    .reduce((sum, q) => sum + (q.rewardPoints ?? 0), 0);

// 「sato が持つ kojira ポイントのシェア %」
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
| 特定発行者 (例: kojira) の総発行 | 発行者 PDS `listRecords(app.aozoraquest.userQuest)` | localStorage 24h |
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
- **特定の発行者のポイントが付くクエスト**: 例「kojiraポイントの出るクエストだけ」

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

aozoraquest 内のクエスト一覧 / 詳細画面でも未読バッジを出す (= 通知 post を「既読」状態にしているかどうかは Bluesky 側の状態を見て判断)。

## 報酬・経験値・バッジ

### 報酬ポイント (発注者発行通貨)

- 発注時に発注者が任意の整数 pt を指定
- 完了 (発注者承認) 時、受託者の **「発注者DID ポイント」保有量に +N pt**
- 通貨種類は発注者 DID で識別。**ポイントは合算されず、種類別に独立**
- 例: 「kojira → sato への 12000 pt 発行」「claude → sato への 500 pt 発行」は別物として両方計上
- 発行上限なし。価値は発注者の信用に依存
- **承認時の増減は不可**。応募時点で受託者が見ていた値で固定発行する (透明性のため)

### システム XP (共通)

| イベント | 受託者 | 発注者 |
|---|---|---|
| クエスト完了 (発注者承認時) | +200 XP | +50 XP |
| クエスト発行 | - | +10 XP (一日 1 件まで) |
| 応募 | +5 XP (一日 3 件まで) | - |
| 受託者指定 | - | - |

ステータス軸への配分は **依頼内容のタグから推定** する (例: タグに `#illust` `#art` があれば LUK、`#code` `#review` があれば INT)。タグ→ステータスのマッピングは **オーナー (kojira) が管理する固定マップ** をアプリ内定数として持ち、PR で更新する。LLM 動的判定は使わない (運用の予測可能性のため)。Phase 2 で実装。

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
- [ ] Worker の kojira セッション保持 + 1 日 1 回の refresh Cron Trigger
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
| **タグ → ステータス XP マッピング** | **kojira (オーナー) のみ管理する固定マップ** | アプリ内の定数として持ち、運用で kojira が PR で更新する。LLM 動的判定はしない |
| **通知システム** | **Bluesky notification に乗せる (= aozoraquest が通知 post を生成)** | 専用 NSID は作らない。通知 post を mention 付きで出すことで、ユーザーの Bluesky 標準クライアントでも気付ける |
| **タイトル/本文の最大長** | **タイトル 80 字 / 本文 1500 字** | 妥当と判断、これで進める |
| **承認時の報酬調整幅** | **増減なし**。元クエストの `rewardPoints` でそのまま発行する | `questCompletion.rewardPoints` は別途持たず、元 record の値を信頼する |
| **自動失効** | **なし**。失効は発注者の明示操作のみ | 募集期限 (`deadline`) は発注者が任意で設定 / 後から変更可能。期限超過は UI 表示のみで status は触らない。「ステータスを変えるのは発注者だけ」というシンプルな原則 |
| **ポイント保有ランキング公開** | **default ON** | プロフィール設定で OFF にできる (opt-out) |
| **シェア% 表示** | **default 表示、opt-out** | 「総発行の N% を保有」は default で見える。設定で消せる |
| **発行者アカウント削除時** | **グレー表示** | 削除済み発行者のポイントは「(削除済み発行者) ポイント」と灰色で表示、集計には残す |

## 付録 A: タグ → ステータス XP 配分マップ (初期値)

kojira がオーナーとして管理する **固定マップ**。アプリ内定数 (`packages/core/src/quest-tag-stats.ts` 等) として持ち、PR で更新する。LLM 動的判定は行わない。

各タグについて、完了 XP (受託者の +200 XP) をどの 5 ステータス軸にどの割合で振るかを定義する。合計は 100。タグが複数付いていれば、各タグの配分をマージ (平均) して算出する。

| タグ | ATK | DEF | AGI | INT | LUK | 含意 |
|---|---|---|---|---|---|---|
| `#illust` `#art` `#design` | 10 | 0 | 20 | 30 | 40 | 創造的、観察、人を惹きつける |
| `#code` `#review` `#debug` | 5 | 15 | 10 | 60 | 10 | 分析、忍耐、技術 |
| `#write` `#blog` `#text` | 15 | 10 | 15 | 50 | 10 | 表現、構造 |
| `#translate` `#proofread` | 5 | 25 | 5 | 60 | 5 | 正確さ、忍耐 |
| `#feedback` `#advice` | 20 | 30 | 10 | 30 | 10 | 伝える勇気と冷静さ |
| `#listen` `#chat` `#counsel` | 5 | 30 | 5 | 10 | 50 | 共感、受容 |
| `#research` `#investigate` | 10 | 20 | 5 | 60 | 5 | 探究 |
| `#walk` `#meetup` `#offline` | 15 | 20 | 30 | 5 | 30 | 行動、社交 |
| `#music` `#perform` | 25 | 5 | 25 | 5 | 40 | 表現、即興 |
| `#cook` `#craft` `#make` | 10 | 20 | 20 | 20 | 30 | 手を動かす総合 |
| (未マップ / その他) | 20 | 20 | 20 | 20 | 20 | デフォルト均等 |

マージ規則 (擬似コード):

```ts
function statXpDistribution(tags: string[]): StatVector {
  const known = tags.map(t => TAG_MAP[t]).filter(Boolean);
  if (known.length === 0) return DEFAULT_FLAT;
  const summed = known.reduce(addStats, ZERO);
  return normalizeTo100(summed);
}
```

このマップは初期値で、ユーザーフィードバックを見ながら kojira が更新する。Phase 2 のリリース時に必ず初版を確定する。

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
報酬: kojiraポイント 12000 pt
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
