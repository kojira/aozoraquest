# 21. あおぞらワールドのサーバー権威化 (チート対策) — 設計 v3

**状態**: 設計提案 (未実装)。§1.5 3 観点レビュー (v2) + オーナー方針転換 (v3: DO 廃止・PDS 権威・物理乱数) を反映。
**背景**: あおぞらワールドの戦闘・報酬・パワー・素材・XP はクライアントで計算し **ユーザー
自身の PDS レコードに書く** ため偽造できる。オーナー「チートできる状態ではリリースできない、
チートできなくなるまで進めて」。

**v3 の方針転換 (オーナー 2026-07-18)**:
- **Durable Object を使わない。** 権威データは **Worker が管理する app サーバー用アカウントの
  PDS** に置く (ユーザーは書けない = 偽造不可)。ATP ネイティブ。既存の依頼クエスト集約
  (docs/15) が「edge Worker が主管理者 PDS に questIndex を書く」のと同じ構図。
- **seed 先読み対策は「Worker がサーバー側で乱数を引き、クライアントに seed を渡さない (毎ターン)」**。
  既定は CSPRNG。物理乱数 (`kuda.kojiran.workers.dev/drop`, ANU 量子乱数, 428lab/kuda) は付加価値の
  任意オプション (障害/枯渇時は CSPRNG フォールバック、クリティカルパスに必須で置かない)。

参照: [[19-overworld]], [[02-architecture]] (要更新), [[15-user-quest]] (Worker→管理者 PDS の前例)。

---

## 1. 脅威モデル
報酬の偽造 / playerSnapshot 詐称 (盛ったステ・装備・Lv) / 乱数の先読み・やり直し / 投稿 XP の
リプレイ / リロード離脱 / 複数端末の二重取得 / 上限回避 / DoS。スコープ外: 気質診断。

## 2. 根本原因
権威データ = **ユーザー自身の repo**。ATP ではユーザーは自分の repo に自由に書けるので偽造できる。
→ **権威データを Worker 管理アカウントの PDS へ移す** (ユーザーに write 権限が無い場所)。

## 3. 設計原則
1. 権威データは **app サーバー用アカウントの PDS** (Worker だけが書ける)。ユーザー PDS には
   表示用ミラーを置いてよいが正本はサーバー側アカウント。
2. **Worker が戦闘を解決** (`packages/core` は決定的・環境独立)。
3. **乱数は Worker がサーバー側で引き、クライアントに seed を渡さない (毎ターン方式)** → 先読み不可。
   これが先読み不可の**必要十分条件**で、物理乱数か否かには依らない。既定は CSPRNG
   (`crypto.getRandomValues`、Worker 内秘匿)。物理乱数 (kuda) は付加価値の任意エントロピー源で、
   障害/枯渇時は CSPRNG にフォールバックし戦闘のクリティカルパスに外部依存を必須で置かない (§4.3)。
4. **戦闘への入力はクライアントからは commands のみ**。ステ/装備/Lv/HP/MP は権威 state のみ。
5. 呼び出し元 DID を検証 (自分の state しか触れない)。
6. **fail-closed**: 認証失敗・PDS 失敗・kuda 失敗・通信断は「報酬を与えない」に倒す。

## 4. アーキテクチャ (DO なし)

### 4.1 権威ストア = app サーバーアカウントの PDS
- **`apps/edge` Worker** が app のサーバー用アカウント (依頼クエスト集約と同じ主管理者 PDS、
  または専用ゲームアカウント) の repo に、**ユーザー DID をキーにした 1 レコード/人**で権威 state
  (パワー残高・冒険 XP/Lv・素材インベントリ・装備 gear・位置) を持つ。ユーザーはこの repo に
  書けない = 偽造不可。NSID 例 `app.aozoraquest.gameState`、rkey = DID の sanitized 形。
- **Worker の PDS 書き込み手段**: サーバーアカウントの認証情報 (app-password か保存した
  OAuth トークン) を **Worker Secret** に置き、`@atproto/api` の Agent で `com.atproto.repo.putRecord`。
  **要 PoC**: `@atproto/api` (base Agent, fetch ベース) が Workers で動くか (oauth-client-node は
  非互換だったが api base は別)。M2 冒頭で確認。
- **並行制御 (二重使用防止)**: `putRecord` の **`swapRecord` (期待 CID) による compare-and-swap**。
  DO の直列化の代わりにこれで通貨の二重消費を防ぐ。
- **CAS の read-modify-write 契約 (DO input-gate 直列化の代替として必須。レビュー ★★★)**:
  swapRecord は楽観的なので、CID 不一致 (409) 時は**単にリトライしてはいけない**。必ず
  (a) 最新 state を再読込 → (b) パワー予約・報酬・claim・turn ガードを**再評価** → (c) 冪等キー
  (battleId+turn / post rkey / quest claim id) で二重適用を弾く → (d) 再 put、の RMW ループにする。
  これを怠ると古い意思決定のまま新 CID で上書きし、二重報酬・二重消費が実装依存で通る (= DO が
  暗黙に守っていた不変条件が復活しない)。**外部 fetch (kuda 等) を挟む場合は取得後に state を
  再検証してから確定**する。**乱数と state の順序**: encounter/turn で seed 採番・turn ガードを CAS
  で先に確定 → その後に乱数を引いて resolve、の順にし、放置/並行で乱数バイトの二重消費/取りこぼし
  を防ぐ。

### 4.2 認証 (呼び出し元 DID) — service auth JWT
クライアントが `agent.com.atproto.server.getServiceAuth({aud: <Worker DID>, lxm, exp})` で短命 JWT
発行 → Worker が発行者 DID の署名鍵で検証。**secp256k1 は Workers の `crypto.subtle` 非対応 →
`@noble/curves` で ES256K を自前検証** (P-256 は subtle)。DID 解決は `did:plc`→plc.directory /
`did:web`→.well-known を fetch。**検証チェックリスト**: `aud`=Worker DID 厳格一致 / `lxm`=呼ぶ
メソッド / `exp`・`iat` / `iss`=解決鍵で確定 / `alg`=ES256K/ES256 のみ (alg confusion 拒否) /
リプレイは下記バトルガード・claim 冪等で実害を消す。Worker の DID は `did:web:edge.aozoraquest.app`
(edge 自身が `/.well-known/did.json` 配信)。

### 4.3 乱数 (既定 CSPRNG、物理乱数 kuda は任意)
- **既定は CSPRNG** (`crypto.getRandomValues`、Worker 内秘匿)。サーバー秘匿 + 毎ターンで先読み不可を
  担保する (§3-3)。戦闘の各乱数消費点で必要バイトを引く (または encounter 時にまとめて引き権威
  state に秘匿保持して消費)。
- **物理乱数 (kuda) は付加価値の任意オプション**: `GET https://kuda.kojiran.workers.dev/drop` で
  ANU 量子乱数 1 バイト (0–255)。使う場合も**クライアントは介在しない** (Worker→kuda のみ)。ただし
  プール有限 (`pool_remaining` 逓減)・外部依存・レイテンシがあるので、**戦闘のクリティカルパスに
  必須で置かず、障害/枯渇時は CSPRNG にフォールバック** (kuda 障害=全戦闘停止を避ける)。使ったソース
  (`drop_seq`/`batch` or CSPRNG) を監査ログに残す。

## 5. 戦闘プロトコル (毎ターン・サーバー乱数)

**C1 (最重要)**: playerSnapshot はクライアントから受けない。encounter 時に **Worker が権威 state
(archetype/Lv/gear/baseStats/開始 HP-MP) から `startBattle` 入力を組み立てて封印**。以後は封印
snapshot のみ使い、commands 以外を戦闘計算に通さない。

**毎ターン送信** (先読み・握りつぶし・やり直しを封じる):
```
[1] POST /api/battle/encounter (JWT lxm=encounter, {x,y})
    Worker: 権威 state 読取 → (x,y) から terrain/tier を core で導出 → 遭遇判定
        → playerSnapshot 封印 (内部 seed も封印) → rewarded=(power>=1) 確定+予約
        → 専用レコード battleGuard を作成 {battleId, turn:0, sealed, pendingTurnSeed}
        → 初期 state を返す (seed は除去)
    ← {battleId, monster, 初期state(HP/MP・seed なし), rewarded}

[2] 各ターン: POST /api/battle/turn (JWT lxm=turn, {battleId, turn, command})
    Worker: バトルガードの battleId/turn 一致を確認 (不一致=リプレイ/やり直し → 409)
        → 確定済み pendingTurnSeed で resolveTurn(封印state, command, turnSeed) を実行
        → バトルガードを turn+1・解決後 state・次 pendingTurnSeed(entropyU32) に CAS 更新
          (CAS 成否で応答をゲート。やり直し不可を確定) → 新 state/events を返す (seed なし)
    ← {state(seed なし), events, outcome}
    決着なら Worker が報酬を権威 state に確定 (勝: XP+ドロップ / 負: xpLose+素材ロス、
    rewarded のみ・パワー1消費)。練習は付与も消費もペナルティも無し・記録なし。ガード削除。
```
- **先読み不可**: 乱数は毎ターン Worker が kuda から引くのでクライアントは事前に知り得ない。
- **やり直し不可**: バトルガードの `turn` を CAS で進めるので、同じターンを別コマンドで引き直せ
  ない (turn 不一致で 409)。→ 物理乱数 + turn ガードで「引き直し厳選」も「分岐総当たり」も封じる。
- **リロード離脱**: 未決着ガードは encounter 時に先に敗北 flush してから新規発行。ガードに
  `expiresAt` を持たせ、経過分は次アクセス時に lazy 敗北確定 (DO Alarm は使わない = DO 無し)。
  **残リスク (レビュー ★★)**: lazy 方式は離脱ユーザーの再アクセスに依存するので、二度と戻らない
  ユーザーの**負けロス (xpLose/素材ロス) は永久に確定しない (踏み倒し)**。パワーは encounter で
  reserve 予約するので二重消費は防げる。負けロスの扱い (練習相当に丸める / 次回ログイン時に flush /
  放置容認) は §9 の判断ポイント。
- **並行/二重**: turn/決着は battleId+turn 一致 + swapRecord CAS で二重報酬を防ぐ。

**★★★ seed をクライアントに一切返さない (M3-part1 レビューで確定)**: `core` の
`rollDrops` / `rollDefeatLoss` / `summonMonster` は**戦闘 seed から決定的**に導出され、その salt は
クライアントバンドル (`packages/core`) にコンパイル済みで含まれる。したがって seed を client に返すと、
クライアントは戦闘を確定する前にドロップ・敗北ロス・敵ステ (分散込み) を**先読み**でき、「良い seed の
戦闘だけ確定し、悪ければ離脱」という選別チートが成立する (これは踏み倒し ★★ も悪化させる)。対策:
1. **client 向け DTO から `state.seed` を除去**。seed はバトルガードの `sealed` (Worker 内) にのみ持つ。
   client には `monster` / HP・MP / events / outcome だけ返す。
2. **報酬 (ドロップ・敗北ロス) も「サーバーが独立に引いたエントロピー」で導出**する。戦闘 seed を
   `rollDrops`/`rollDefeatLoss` に再利用しない (これらは既に seed 引数を取るので、Worker が別に引いた
   32bit を渡すだけでよく、core の署名変更は不要)。ターン戦闘・召喚・ドロップ・敗北ロスで**別々の**
   新鮮なエントロピーを使えば、可視の敵ステから召喚 seed を逆算されても他は漏れない。

**resolveTurn への乱数注入 (M3-part1 で実装済み)**: 現 `core` は seed から `turnRng` を作る。Worker が
毎ターン引いた新鮮なエントロピーを注入できるよう `resolveTurn(prev, command, turnSeed?)` の薄い口を
足した (seed 方式と両立。省略時は従来 `turnRng` = 試練/テストは不変)。**turnSeed は 32bit の新鮮な
エントロピーであること (8bit では 256 通りに縮退し総当たりで先読みされる ★★)**。`entropyU32()` を使う。
バトルガードは次ターン分の `pendingTurnSeed` を CAS 確定時に事前採番して封じ、リトライ冪等かつ
commands 送信前に client が次乱数を知り得ないようにする。レイテンシは DQ メッセージ送りで隠す。

## 5.5 クライアント権威はゼロにする (オーナー方針 2026-07-26)

> クライアント権威はゼロにしないとチートになったり不整合起こすだけだよ

**同じ値を「ユーザー自身の PDS」と「権威 state」の 2 箇所に持たない。**
ユーザー自身の PDS は本人がブラウザから自由に書けるので、そこを信じている限り
チートは塞げない。そして 2 箇所ある限り、片方だけ更新される経路が必ず生えて不整合が出る。

実際に起きた事故 (2026-07-26): 管理画面のパワー付与がユーザー側の PDS しか書いておらず、
画面には残高 152 と出るのに権威側は 0。`rewarded = power >= powerCost` が false になり、
**勝っても XP もドロップも入らない**のに画面には何も出なかった。XP でも同じことが
起きていた (#534 で一本化)。

**新しいゲーム状態を足すときは、最初から権威 state に置く。**
「まず client で作って後で移す」は、移行が途中で止まって 2 箇所ある状態が固定化する
(このリポジトリで実際にそうなった)。

残っているクライアント権威の棚卸しと段階的な撤去は **#551**。

### 済んだもの

- **XP** (#534) — 投稿・デイリークエスト・依頼クエスト・戦闘のすべてが `GameState.jobXp`
- **あおぞらパワー** (#551 段階 1) — 残高の正は `GameState.power` だけ。増減の**全経路**:

  | 操作 | 経路 |
  |---|---|
  | 投稿 | `/api/xp/claim` が +1 |
  | 戦闘 | `battle-reward` が −1 |
  | しらべる | `/api/world/search` が −1 (以前は client 台帳だけで、実質無料だった) |
  | なんでも屋の購入 | `/api/shop/craft` が −費用 |
  | 素材のひきとり | `/api/shop/sell` が +入金 |
  | カードの引き直し | `/api/power/spend` が −1 (以前は client 台帳だけで、**ワールドで使った分が引かれず二重に使えた**) |
  | 管理付与 | `/api/power/admin-grant` |

  `power/self` (ユーザー PDS の台帳) は **召喚ゲージ (`viaPosts`) 専用**に降格。残高の表示にも
  判定にも使わない。

- **素材** (同上) — 購入・ひきとりで権威側の在庫を増減する。以前は client がメモリ上のマップを
  書き換えるだけで、**リロードすれば素材が戻った** (= 複製できた)
- **装備の個体** (段階 2) — `GameState.pieces` が所持の正。作れるのは `/api/shop/craft` と
  `/api/shop/forge` だけ。`/api/world/gear` は `sanitizeGear` で**所持していない品と、
  持っていない強化値を落とす**。以前は client の申告を無検証で保存しており、
  `{weapon:{id:'wp-shogun-high',level:99}}` を POST するだけで戦闘に効いた。
  ユーザー PDS の `craft` レコードは**履歴**に降格 (所持の根拠ではない)
- **素ステ** (段階 3) — `analysis.rpgStats` はユーザー PDS にあり本人が書けるが、
  サーバーで `normalizeStats` を掛け直す。正当な診断結果は `computeStats` が最後に
  同じ正規化を通すので**必ず合計 100** になる。よって**形 (どのステに寄っているか) は残り、
  大きさだけ盛れなくなる**。サーバーが投稿から診断をやり直す (M4) までの間、これで塞ぐ

- **職 (archetype)** — `readDiagnosis` が実在する職かを確かめる。以前は任意の文字列が
  そのまま職として使われ、`JOB_KITS[archetype]` が undefined になって「とくぎが 1 つも無い」
  という無言の壊れ方をした。なお職を書き換えても `jobXp` は職ごとに別なので、
  その職を遊んでいなければ **Lv1 から**になる (#534 の副産物として、盛る動機自体が薄い)
- **XP の申告** — 1 回あたりの上限クランプに加えて **1 日あたりの上限** (`MAX_DAILY_CLAIM_XP`)。
  申告の根拠 (投稿の分類・クエストの達成) は client にあってサーバーは検証できないので、
  回数を無制限にすると何回でも盛れた。日付はサーバーの時計で決める。
  **依頼クエストの自作自演も弾く** — 冪等キーがクエストの URI なので、そこから発注者の DID を
  読んで申告者と一致すれば拒否する (1 日 5 件作れるので放置すると 500 XP/日 が湧く)

### 残っているもの

- **投稿の実在・本人検証** — `/api/xp/claim` は「その投稿が本当にあるか」を見ていない。
  日次上限で被害は頭打ちだが、**額の根拠そのものは client のまま**。M4 で `/api/xp/post` に置き換える
- **デイリークエストの達成判定** — 投稿の分類が端末内 ONNX なので、サーバーが同じ判定を
  再現できない。日次上限が唯一の歯止め
- **レート制限** (#548) — 1 申告 = 共有 repo への 1 コミット。docs §9-1 の直列化リスク
- **位置の初期値** — `migrateInitState` が初回だけユーザー PDS の `world/self` から取り込む
  (以後は権威側)。移動そのものは署名トークンで権威化済み

## 5.6 単一 repo の書き込み天井と、その先の選択肢 (#548)

権威 state は**全ユーザーが 1 つのサーバーアカウント repo を共有**している (§9-1)。
Bluesky の書き込み上限は DID ごと **5,000 points/時 ・ 35,000 points/日**、`putRecord` は 2 points:

```
1 操作 = putRecord 1 回 = 2 points
→ 全ユーザー合計で 1 時間 2,500 操作 / 1 日 17,500 操作が天井

 10 人 × 1 日 200 操作 =  2,000 → OK
 50 人 × 1 日 200 操作 = 10,000 → OK
100 人 × 1 日 200 操作 = 20,000 → 超過
```

「1 操作」= 移動 (街に入るとき) / 戦闘 1 ターン / しらべる / 購入 / 素材のひきとり / 投稿の申告。
**時間あたりが 2,500 なので、夜のピークだと 50 人規模でも当たりえる。**

### 気づく手段 (実装済み)

`serverPutRecord` の応答から `ratelimit-*` ヘッダを拾い、**Cloudflare KV** に残して
`GET /api/admin/pds-usage` で管理画面に出す。8 割を超えたら警告する。

- **PDS には書かない。** 計測のために PDS へ書いたら、その書き込み自体が point を食って本末転倒
- **KV にも 1 日 1,000 write の上限**があり、PDS の天井 (17,500) より低い。毎回書くと
  計測が先に飽和して本体を止めるので **5 分に 1 回**に間引く (= 288 write/日、上限の 29%)。
  ただし残量 2 割を切ったら毎回残す — 逼迫時こそ数字が要る
- 読み取りは point を消費しないので、管理画面を何度開いても天井には効かない

### 天井が見えたときの選択肢

| | 上限 | CAS (二重使用防止) | 備考 |
|---|---|---|---|
| **PDS を自前ホスト** | **自分で決められる** | ✅ そのまま | AT Proto の意味論を維持。分割せずに天井だけ外せる |
| サーバーアカウントを N 個に分割 | N 倍 | ✅ | DID のハッシュで振る。コード変更は小さい |
| Durable Object | 実質なし | ✅ (単一スレッド) | Workers Paid が要る |
| Nostr リレー | 緩い (自前で立てられる) | ❌ | 下記 |

**Nostr リレーは条件付き書き込みを持たない。** 署名が正しければ受け付けるだけで、
replaceable event も `created_at` の後勝ち。`swapRecord` の CAS が担っている
「読んだときの CID と一致するときだけ書く」= 二重報酬・二重使用の防止が失われる。
前イベントの id を参照するハッシュチェーンで fork 検出はできる (書き手が実質 Worker 1 つなので
今の read-modify-write + リトライとほぼ同じ形になる) が、リレーが調停しないので
「両方通ってから読み側で気づく」型になる。**権威 state の置き場としては採らない。**

一方 **計測・監視のような CAS が要らないデータには向く**。今のスナップショット 1 個では
「いま何割か」しか分からず「どの速さで近づいているか」が出ないので、傾きが要るように
なったら追記型のログとして検討する (オーナー提案 2026-07-27)。

## 6. XP は本番と共有 (オーナー決定 A: XP も権威化)
`analysis/self` の XP/Lv は本番カード表示でも使う。A を採る:
1. 戦闘 XP → §5 決着で権威 state に付与。戦闘入力の Lv は必ず権威値 (C1 と同原則)。
2. 投稿 XP → **M4 の到達目標**は `/api/xp/post {postUri}` で Worker が post の実在・本人を
   検証して付与。**「アプリ経由」は ATP で原理的に検証不能**なので「本人の実在 post なら付与」に
   緩め、bot 稼ぎはレート制限 + 既存 post-processor 分類で緩和。

   **現状 (#534 で実装済み)**: `POST /api/xp/claim {kind, archetype, xp, key}`。
   client が算出した XP を申告する。**冪等キー** (`GameState.xpClaims` に直近 200 件のリング) と
   **種類ごとの上限クランプ** (`XP_REWARDS` から導く) は入っているが、**post の実在・本人検証と
   レート制限はまだ無い**。したがって:
   - **XP 額の偽造の天井は M4 まで開いたまま。** 旧 `analysis.jobLevel.xp` (ユーザー自身の PDS)
     でも開いていたので後退ではないが、「冪等キーがあるから偽造できない」は**誤り** —
     `key` は client が決める任意文字列で、毎回新しい値を送れば通る。冪等キーが守るのは
     正直なクライアントのリトライ・二重送信だけ。
   - **共有 repo への書き込み量という新しい面は増えた。** 1 申告 = サーバーアカウント repo への
     1 コミットで、§9-1 の直列化リスクを認証済みユーザーが任意回数叩ける。**レート制限 (§10) が
     M4 を待たずに要る** (未実装)。
3. カード表示ミラー: 権威 Lv はサーバー。PDS `analysis` は表示ミラー。まず「クライアントが
   ミラーを書く (表示 Lv 詐称は可・実戦力は権威)」割り切り。成立条件は C1 (resolve はミラーを
   読まない)。ランキング等 (M6) の前に「Worker がミラーを書く」へ上げる。
4. 移行: **ジョブ XP は取り込まない** (#534)。ベータの区切りとして全員 Lv1 から再スタートし、
   過去の到達レベルは `analysis.jobLevel.xp` に凍結して `/me` の記録に出す。取り込むと
   投稿由来の XP が申告ぶんと二重に効くため。パワー残高と位置は従来どおり上限クランプして取り込む
   (`migrateInitState`)。区切りのマーカーは `GameState.xpEpoch` (`version` は書き込みのたびに
   上書きされるので片道マーカーにならない。docs/19 §6.4.6)。

## 7. パワーモデル (サーバー enforce)
「歩く消費は廃止 / パワー無しは勝敗どちらも何も貰えない (シンプル)」を Worker で: 歩く・遭遇・
戦闘は自由。encounter で `rewarded=残高>=1` を確定+予約。決着で rewarded かつ勝/負なら報酬+
パワー1消費、練習は何もなし。(クライアント WIP は `feature/power-model-simplify` に退避、M3 で
サーバー側に作り直す。)

## 8. マイルストーン計画 (DO 無し・課金不要)
- **M0 (本書)**: 設計合意。
- **M1 — 認証基盤**: `@noble/curves` で service auth JWT (ES256K/ES256) 検証 + DID 解決の PoC、
  §4.2 チェックリスト、`did:web:edge.aozoraquest.app` + `/.well-known/did.json`、`/api/whoami`。
  併せて docs/02 に「edge Worker とゲーム経済は "サーバー層なし" 原則の例外」を追記。本番影響ゼロ。
- **M2 — Worker→サーバー PDS 書込 + 権威 state**: `@atproto/api` が Workers で動く PoC → サーバー
  アカウント認証情報 (Secret) で putRecord。`app.aozoraquest.gameState` レコード (per DID)。
  `GET /api/me/state` (JWT 必須・自分のみ)。初回はクランプ移行。compare-and-swap 実装。**課金不要
  (DO 無し)。**
- **M2.5 — OAuth write 認証基盤 (§12)**: app-password が legacy 廃止トレンドのため、書き込み認証を
  AT Proto OAuth (confidential client) + DPoP + cron refresher で組む。client-metadata + KV トークン
  ストア + アプリ内設定の管理者リンクからの初回 OAuth。M3 の書き込みはこれを消費。
- **M3 — 戦闘の権威化**: §5 の毎ターンプロトコル (encounter/turn) + kuda 物理乱数 + core への乱数
  注入口。playerSnapshot 封印、パワー/素材/gear/戦闘 XP を権威 state に。§7 パワーモデル。
  part1 (乱数機構) ✅ #347 / part2 (resolver、M2.5 の write 認証を消費)。
- **M4 — 投稿 XP の権威化**: `/api/xp/post` + 冪等化 + レート制限。「アプリ経由」要件緩和。
  **冪等化は #534 で先行実装済み** (`/api/xp/claim`)。M4 に残るのは **post の実在・本人検証**と
  **レート制限**の 2 つ。
- **M5 — リリース判断**、**M6+ — 対人 (トレード #327/ランキング)**。

各 M は feature ブランチ → dev → §1.5 レビュー → dev 確認。M1 から順に。

## 9. 未解決の判断ポイント
1. **権威 state の置き方 (スケール、レビュー ★★)**: 全ユーザーを**単一 repo に per-DID レコードで
   集約**すると、PDS の commit は repo 単位で直列化され事実上のグローバルロックになりスループットが
   頭打ちになりうる (per-DID CAS で狙った並行性と両立しない)。**per-DID の別 repo** (ユーザーごとに
   サーバー管理の repo を作る) と比較して決める。加えて 1 repo の MST 肥大・PDS レート制限も要検証。
   → M2 の PoC 合格条件に「N ユーザー相当の書込負荷での commit レイテンシ実測」を入れる。
   アカウント (主管理者と共用 / 専用ゲームアカウント) はこの下位の判断。
2. **kuda**: 既定 CSPRNG + kuda は任意付加価値 (§4.3)。kuda をどこまで使うか (監査エントロピー源のみ /
   非同期補充プール / 使わない)。
3. **負けロスの踏み倒し** (§5 リロード離脱の残リスク): 練習相当に丸める / 次回ログイン flush / 容認。
4. 移行の信頼方針 (クランプ/リセット)、カードミラー方針、通信断 UX (fail-closed)。

## 10. レート制限 / DoS / kuda 枯渇
service auth は本人確認まで。本人連打の DoS/無料枠食い潰しは権威 state 内カウンタで**レート制限**。
`commands`/turn 入力は長さ・値をバリデーション。日次上限リセットはサーバー時刻 (UTC/JST 固定)。
kuda は `pool_remaining` を監視し、枯渇/障害時は fail-closed か CSPRNG フォールバック (§9-2)。

## 11. 実装しない選択肢との比較
- 現状 (ユーザー PDS のまま): チート可 → リリース不可。
- **本設計 (Worker + サーバーアカウント PDS 権威 + サーバー乱数(既定CSPRNG/任意kuda) + 毎ターン + snapshot 封印)**: DO 不要・
  課金不要・ATP ネイティブ。`packages/core` 決定性と既存 edge Worker と kuda を活かす。AT Proto の
  "PDS が正本" のまま、**正本の repo をユーザーから app サーバーアカウントへ移す**のが要点。

## 12. OAuth write 認証基盤 (M2.5、app-password を使わない)

**背景 (方針変更)**: 当初は権威 state への書き込みをサーバーアカウントの **app-password** (Worker
Secret) + `createSession` で行う設計だった (§4.1)。しかし **app-password は Bluesky が OAuth へ移行する
流れで legacy 扱い → 将来廃止の可能性**があるため、書き込み認証を **AT Protocol OAuth (confidential
client) + DPoP** で組み直す。これを M3-part2 (resolver) の前段 **M2.5** として先に作る。

### 12.1 なぜ cron refresher か
OAuth の refresh token は **単回使用でローテーション**する。stateless な Worker は複数 isolate で
並行するので、複数箇所が同時に refresh すると token が壊れてロックアウトする。→ **refresh するのは
Cron Trigger Worker 1 つだけ**に限定 (書き手を直列化)。リクエスト処理 Worker は現在の access token を
**読むだけ**で refresh しない。Cron Trigger は無料プランで使え、DO/Paid 不要の方針を維持する。

### 12.2 構成要素
- **client-metadata.json**: edge に公開する confidential client メタデータ (`client_id` = その URL)。
  M1 の `did:web:edge.aozoraquest.app` + well-known 配信インフラを流用。トークン寿命を延ばすため
  **`private_key_jwt`** でクライアント認証する。
- **クライアント鍵 (ES256 JWK)**: `private_key_jwt` 署名用。安定なので Worker Secret。公開鍵は
  client-metadata の `jwks` に載せる。署名は `@noble/curves` (M1 と同じ道具、重い依存を足さない)。
- **DPoP 鍵 (P-256)**: 全トークン/PDS リクエストは DPoP バインド (sender-constrained)。毎リクエストで
  DPoP proof JWT を生成。安定鍵なので Worker Secret。
- **トークンストア (Cloudflare KV)**: `{accessToken, refreshToken, expiresAt, pdsUrl, authServer}` を
  1 レコードに。**PDS 用 DPoP-Nonce は別キー** (トークン本体は cron が書き手、nonce はリクエスト
  Worker が更新するので、同一レコードにすると RMW でトークンを巻き込むため分離。レビュー ★★)。
  `pdsUrl` を持たせて M3 書込が DID doc を毎回再解決せずに済むようにする。KV は結果整合だが、access
  token は refresh 後も期限まで有効なので少し古くても可 (refresh token の単回性が効くのは cron のみ)。
- **Cron refresher Worker**: access token 失効前に refresh → 新トークンを KV へ。**refresh 成功後の
  KV 保存失敗 = 旧 refresh token 消費済みでロックアウト**が弱点 → 失敗は監査ログ + 管理画面で再 OAuth。
  cron の tick は重なりうる (KV に CAS が無い) ので、refresh 前に `refreshingUntil` ソフトロックを立てて
  他 tick を控えさせる (厳密でないが二重 refresh を大幅に抑える。レビュー ★★)。
- **管理画面 (アプリ内設定)**: 初回だけ owner が authorize (code+PKCE) → callback で初期 refresh token
  を KV に格納。**別アプリ (apps/admin) ではなく、メインアプリの設定画面内に「管理者 DID でログイン
  している時だけ」表示する管理者リンク**から入る (owner 要望)。ロックアウト時も同じ導線で再 OAuth。

### 12.3 リクエスト時の書き込み経路
encounter/turn 等の書き込み Worker: KV から access token + DPoP 鍵を読む → PDS へ DPoP 認証付き
putRecord/deleteRecord。token 失効 (401) は **fail-closed (503)** に倒し、次の cron 補充を待つ
(request Worker は refresh しない = 直列化維持)。cron 間隔 << token 寿命にしてダウンタイムを避ける。
`server-session.ts` (app-password 版) はこの OAuth トークン読取に置き換える (`withServerAuth` の
「失効時リトライを1箇所に閉じ込める」構造は流用)。

### 12.4 owner セットアップ (app-password の "Secret 1個" より増える)
1. Cloudflare KV namespace 作成 + wrangler binding。**(済: アシスタントが作成・binding)**
2. クライアント鍵・DPoP 鍵を Secret 設定 (鍵生成スクリプト `scripts/gen-oauth-keys.mjs`)。SERVER_DID
   (= サーバーアカウントの DID)・ADMIN_DIDS を Variable 設定。
3. **edge Worker を初回デプロイ** — 認可サーバーが authorize/PAR 時に `client_id`
   (=`/client-metadata.json` の URL) を fetch するので、**OAuth ログインより前に edge が serve
   している必要がある** (deploy → Secret 投入 → OAuth の順)。
4. アプリ内設定 → 管理者リンク → 1 回 OAuth ログイン (初期 refresh token を格納)。
`SERVER_HANDLE` は廃止 (OAuth は DID/handle 解決で処理)。サーバーアカウントの handle/DID は Secret/Variable で持ち、ソースに書かない (§9-1 確定)。

### 12.5 実装順 (mock で単体テスト、owner セットアップ後に dev 疎通)
1. DPoP / private_key_jwt の JWT 生成・検証ユーティリティ (@noble、単体テスト)。
2. client-metadata.json 配信 + OAuth authorize/callback ルート (PKCE)。
3. KV トークンストア抽象 + cron refresher。
4. 書き込み経路を OAuth トークン読取へ (server-session 置換)。
5. アプリ内設定の管理者リンク (管理者 DID 限定表示) → OAuth 開始導線。
