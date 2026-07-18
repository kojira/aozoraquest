# 21. あおぞらワールドのサーバー権威化 (チート対策) — 設計

**状態**: 設計提案 (未実装)。オーナー承認後に実装フェーズへ。
**背景**: あおぞらワールドの戦闘・報酬・パワー・素材は現状すべて **クライアントで計算し
ユーザー自身の PDS レコードに書く** ため、その気になれば自分の記録を偽造できる
(XP・パワー・素材の水増し、勝敗の捏造)。オーナー言明「チートできる design は望んで
いない = チートできる状態ではリリースできない」。本書はそれを非チート化する設計。

参照: [[19-overworld]] (W3 権威化の当初メモ), [[02-architecture]], [[18-brusukon-trial]]。

---

## 1. 脅威モデル (何を防ぐか)

- **報酬の偽造**: 戦っていない/負けたのに XP・素材・パワーを得る。
- **seed farming**: 有利な seed を選んで確定勝利・レア素材を狙う (現状 seed = クライアントの `Math.random`)。
- **リロード離脱**: 負けそうになったら閉じてペナルティ回避 (現状は仮レコードで一部対策、ただしクライアント任せ)。
- **複数端末の同時進行**: パワー・在庫の Last-Write-Wins による巻き戻り/二重取得。
- **上限回避**: 試練の日次上限をクライアント集計で超過。

**防がないもの (スコープ外)**: 診断 (気質) はユーザーの自己表現でありチートの旨味が薄い。
本書は「ゲーム経済 (パワー・XP・素材・進行) の権威化」に絞る。

## 2. 根本原因

権威データ = **ユーザー自身の PDS repo のレコード** で、クライアントが直接 `putRecord`
する。AT Protocol ではユーザーは自分の repo に自由に書けるので、アプリを経由せず値を
偽造できる。→ **権威データをユーザー PDS から、サーバー管理のストアへ移す**しかない。

現状のチート対象レコード (`apps/web/src/lib/collections.ts`):

| NSID | 内容 | 書込経路 |
|---|---|---|
| `app.aozoraquest.power/self` | あおぞらパワー累積カウンタ | `points.ts` |
| `app.aozoraquest.analysis/self` | 診断 + **XP/レベル** | `battle-log.ts awardBattleXp` |
| `app.aozoraquest.battle/*` | 戦闘記録 (seed + outcome のみ、**コマンド列は無し**) | `battle-log.ts` |
| `app.aozoraquest.world/self` | 位置・解禁リージョン | `world-state.ts` |
| `app.aozoraquest.gear/self`, `craft/*` | 装備・制作 | `crafting.ts` |

## 3. 設計原則

1. **権威データはサーバー管理ストアに置く** (ユーザー PDS からは直接書けない場所)。PDS には
   携帯性のため read-only ミラーを置いてよいが、正本はサーバー。
2. **サーバーが戦闘を再シミュレーションして報酬を確定** する。`packages/core` は環境独立・
   決定的 (`createRng`/`resolveTurn`) なので、Worker が同じエンジンで seed+コマンド列から
   結果を再現でき、クライアントは偽造できない。
3. **seed はサーバー発行** (クライアントの `Math.random` を廃止)。seed farming を封じる。
4. **呼び出し元の DID をサーバーが検証** する (自分の状態しか触れない)。
5. できるだけ**軽く**始める。移動の 1 歩単位までリアルタイム権威化はせず、**報酬が確定する
   瞬間 (遭遇発行 / 決着) だけサーバーに通す**のが最小で効く。

## 4. アーキテクチャ

### 4.1 コンポーネント
- **`apps/edge` Worker (既存, `aozoraquest-edge`)** に `/api/world/*` を追加。`packages/core`
  を import して再シミュレーション。nodejs_compat 有効。
- **`PlayerDO` (Durable Object, per DID)** = 権威ストア。1 プレイヤー = 1 インスタンス:
  - あおぞらパワー残高 (正本)
  - 冒険 XP/レベル (§6 の判断次第)
  - 素材インベントリ
  - 位置・解禁リージョン (world/self の正本)
  - **進行中バトル** {battleId, seed, monsterId, playerSnapshot, rewarded, expiresAt}
  - 日次カウンタ (試練上限 等)
  - **なぜ DO**: 通貨・在庫は per-DID の直列一貫性が要る (二重取得・複数端末・リロード離脱の
    防止)。DO は 1 DID を 1 アクターに直列化し、進行中バトルのロックも自然に持てる。
  - 代替案: D1 (単一 SQLite) + トランザクション。単純だが並行制御を自前で書く必要があり、
    ゲーム経済では DO-per-DID がイディオム。**推奨は DO**、D1 は候補。
- **ストレージバインディング**: `wrangler.toml` に DO を追加 (現状バインディング無し)。

### 4.2 認証 (DID 本人確認)
`@atproto/oauth-client-node` は Workers 非互換 (edge の probe で確認済み)。per-user リクエストの
本人確認は **AT Protocol の service auth (inter-service JWT)** を使う:
- クライアントが `agent.com.atproto.server.getServiceAuth({ aud: <Worker の DID>, lxm: <エンドポイント> })`
  で短命 JWT を発行 (署名鍵はユーザーの署名鍵)。
- Worker はその JWT を受け、**発行者 DID の DID document の署名鍵で検証** → 呼び出し元 DID を確定。
- 秘密情報の共有不要。Web Crypto (P-256/secp256k1) で検証実装。
- 要件: Worker 自身に DID を 1 つ持たせる (aud 用)。did:web でよい。

### 4.3 seed 発行
- 遭遇成立時に Worker が `seed = HMAC(KEY_SECRET, did | battleCounter)` を発行し DO に記録。
  `KEY_SECRET` は Worker Secret。counter は DO 単調増加。→ 同一 seed の再取得・巻き戻し不可。

## 5. フロー (戦闘)

```
[1] POST /api/world/encounter  (JWT, {x,y})
    Worker: DID 検証 → PlayerDO
    DO: 進行中バトル無しを確認 → 遭遇判定 (server seed) → tier/モンスターを core で決定
        → rewarded = (power残高 >= 1) を確定 → 進行中バトルを記録
    ← {battleId, monster, rewarded}

[2] クライアントはローカルで戦闘を進行 (決定的シミュ = 即時レスポンスの手触り)。
    コマンド列を貯める。UI は従来どおり。

[3] POST /api/world/resolve  (JWT, {battleId, commands[]})
    Worker: DID 検証 → PlayerDO
    DO: 保存した {seed, monster, playerSnapshot} + commands を core で再シミュ
        → 権威 outcome を得る。rewarded なら報酬適用 (XP/素材/パワー-1、敗北で素材ロス)。
           練習 (rewarded=false) は何も付与/消費しない。進行中バトルをクリア。
    ← {outcome, rewards, 新しい権威state (power/xp/inventory/hp/mp)}

[4] クライアントは server の確定結果を表示。ローカルシミュと食い違えば server が正
    (= チート試行は弾かれる)。
```

- **リロード離脱**: resolve せず放置した進行中バトルは、次の encounter 要求時 or `expiresAt`
  経過で DO が「棄権 = 敗北」として確定 (rewarded なら素材ロス)。クライアント任せをやめる。
- **読み取り**: `GET /api/world/state` で権威 state を取得。クライアントはこれを表示に使う
  (PDS の power/self や analysis の XP を表示の正本にしない)。

## 6. 最大の論点 — XP は本番と共有

`analysis/self` の `playerLevel.xp` / `jobLevel.xp` は **本番のカード表示・診断・レベリングでも
使われている**。投稿由来 XP (`post-processor`) と戦闘由来 XP の両方がここに加算される。
戦闘 XP をサーバー権威に移すと、XP の正本が二重化して本番に波及する。選択肢:

- **A. レベリングごとサーバー権威 (きれい・大)**: すべての XP/レベルを DO 正本にし、PDS
  `analysis` は read-only ミラー (カード表示用)。post-processor の投稿 XP 加算も Worker 経由に。
  → 一番きれいだが本番 (投稿フロー・カード) に触れる大移行。
- **B. 冒険経済だけ権威化 (スコープ小・現実的)**: **パワー残高・素材インベントリ・進行中
  バトルのロック** を DO 正本にする (これらは純ゲーム通貨で本番カードに出ない)。**戦闘 XP は
  当面 PDS のまま** = XP はまだ偽造可能だが、「報酬素材と装備・パワー経済」は非チート化される。
  リリースで「他人に影響する経済 (トレード/ランキング)」を出さない限り、XP 偽造は自己完結
  (自分のカードのレベルを盛るだけ) なので実害が小さい。
- **C. 冒険 XP を診断 XP から分離**: 戦闘は別の「冒険レベル」を DO で持ち、診断のレベルとは
  切り離す。ただし戦闘の強さは診断由来の playerLevel/jobLevel に依存する現設計なので、分離は
  再設計が要り筋が悪い。

**推奨**: まず **B (冒険経済=パワー/素材/在庫/バトルロックを権威化)** を Phase 1 で出す。XP の
完全権威化 (A) は Phase 2。理由: 装備・素材・パワーの経済が非チート化されれば「実際に他人と
関わる価値 (トレード・ランキング)」を安全に出せる下地になる。XP=自分のカードのレベルは自己
満足の範囲で、優先度が一段低い。

### 決定 (オーナー 2026-07-18): A = XP も最初から権威化

オーナー選択により **A (レベリングごとサーバー権威)** を採る。これに伴い含まれる範囲を明示:

1. **戦闘 XP** (world/試練) → resolve でサーバー付与 (再シミュ)。
2. **投稿 XP** → 投稿するとレベル XP が入る (`post-processor` が `analysis.playerLevel.xp` /
   `jobLevel.xp` に加算)。完全権威化なら **投稿由来 XP もサーバーが検証して付与**する必要が
   ある = クライアントは「この post を作った」と URI を送り、Worker が **その post を PDS から
   取得して実在・本人・アプリ経由を検証**して XP を付与。これが一番重い追加。
3. **カード表示 (社会的)** → 他人があなたのカードのレベルを見るとき、権威値は DO 側。
   PDS `analysis` は表示ミラーにする。ミラーの書き手をどうするか:
   - (i) Worker がユーザー PDS にミラーを書く = ユーザーが Worker に write scope の OAuth 同意を
     与える必要 (confidential client)。表示も非詐称。
   - (ii) クライアントがミラーを書く = 表示 Lv は詐称可能だが**実戦力はサーバー権威**なので
     「見た目の Lv 詐称」止まり (ゲーム的な得は無い)。実装は軽い。
   - **要判断**。まずは (ii) で割り切り、後で (i) に上げるのが現実的。
4. **移行** → 既存プレイヤー (dev のみ = 実質オーナー) の PDS 現 XP を DO 初回アクセス時に読み込む。

## 7. パワーモデル (サーバー enforce)

オーナー要望「歩く度の消費は廃止 / パワーが無いと勝っても負けても何も貰えない (それが
シンプル)」を **DO で enforce** する:
- 歩く・遭遇・戦闘は自由。encounter 時に DO が `rewarded = 残高>=1` を確定。
- resolve 時、rewarded かつ決着 (勝/負) なら報酬適用 + パワー1消費。練習 (残高0) は付与も消費も
  ペナルティも無し・記録も残さない。
- これをクライアントでなく DO が判定するのでチート不可。(クライアント側の暫定実装は
  `feature/power-model-simplify` の WIP に退避済み。Phase 1 でサーバー側に作り直す。)

## 8. マイルストーン計画 (XP 権威化 = A を含む)

大きいので、各マイルストーンが単独で価値を出し・壊さない粒度に割る。

- **M0 (このドキュメント)**: 設計合意。
- **M1 — 認証基盤**: edge Worker に DID (did:web) を持たせ、`getServiceAuth` JWT の検証を実装
  (`/api/whoami` で「あなたは DID X」を返すだけ)。ここで「サーバーがユーザーを本人確認できる」
  土台が立つ。DO はまだ無し。単独で検証可能・本番影響ゼロ。
- **M2 — PlayerDO + 読み取り**: `PlayerDO` (per DID) を追加。初回アクセスで PDS の現 state
  (power/analysis XP/materials/world) を DO に読み込む (移行)。`GET /api/me/state` で権威 state
  を返す。まだ書き込み経路は変えない (影・並走)。DO と PDS の値が一致することを確認。
- **M3 — 戦闘の権威化**: `/api/world/encounter` (server seed + rewarded 判定 + バトルロック) と
  `/api/world/resolve` (再シミュ → 報酬確定 → DO 更新)。world をこの API 経由に配線。パワー/
  素材/XP(戦闘分) が DO 正本に。§7 パワーモデルも DO で enforce。**この時点で戦闘経由のチートは
  封じられる。**
- **M4 — 投稿 XP の権威化**: 投稿フローを `/api/xp/post {postUri}` 経由に。Worker が post を
  PDS から検証して XP 付与。これで XP の全経路がサーバー権威に。カード表示ミラー方針 (§6-3) を
  確定。
- **M5 — 本番リリース判断**: 経済+XP が非チート化 → world を本番に出せる。
- **M6+ — 他人に影響する機能**: プレイヤー間トレード (#327) / ランキング。M1–M4 の権威化が前提。

各マイルストーンは feature ブランチ → dev → §1.5 レビュー → dev 確認、の通常運用。M1 から順に。

## 9. 未解決の判断ポイント (オーナー確認)

1. **権威ストア**: Durable Object (推奨) か D1 か。
2. **XP のスコープ**: Phase 1 で §6-B (経済だけ) にするか、最初から §6-A (XP も) にするか。
3. **Worker の DID**: service auth の aud 用に did:web を 1 つ用意してよいか。
4. **移行**: 既存プレイヤー (dev のみ、実質オーナー) の PDS 現状態を DO へ初期ロードする方式。
5. **オフライン/レイテンシ**: 決着ごとに ~50-150ms のサーバー往復。演出 (メッセージ送り) で
   隠せるが、通信断時の扱い (再送 / 一時ローカル表示) の方針。

## 10. 実装しない選択肢との比較 (正直な整理)

- **完全に PDS のまま (現状)**: 実装ゼロだがチート可能 → リリース不可 (オーナー方針)。
- **クライアント難読化のみ**: 気休め。決定的に破られる。非推奨。
- **本設計 (サーバー再シミュ + DO 正本)**: 実装コストはあるが `packages/core` 決定性 + 既存
  edge Worker のおかげで現実的。**AT Proto の "PDS が正本" 設計から、ゲーム経済だけ "サーバーが
  正本" にずらす**のが要点。
