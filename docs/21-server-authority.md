# 21. あおぞらワールドのサーバー権威化 (チート対策) — 設計 v3

**状態**: 設計提案 (未実装)。§1.5 3 観点レビュー (v2) + オーナー方針転換 (v3: DO 廃止・PDS 権威・物理乱数) を反映。
**背景**: あおぞらワールドの戦闘・報酬・パワー・素材・XP はクライアントで計算し **ユーザー
自身の PDS レコードに書く** ため偽造できる。オーナー「チートできる状態ではリリースできない、
チートできなくなるまで進めて」。

**v3 の方針転換 (オーナー 2026-07-18)**:
- **Durable Object を使わない。** 権威データは **Worker が管理する app サーバー用アカウントの
  PDS** に置く (ユーザーは書けない = 偽造不可)。ATP ネイティブ。既存の依頼クエスト集約
  (docs/15) が「edge Worker が主管理者 PDS に questIndex を書く」のと同じ構図。
- **seed の先読み対策は物理乱数** (`https://kuda.kojiran.workers.dev/drop`, ANU 量子乱数プール、
  428lab/kuda) を Worker が引く。物理乱数は構造的に予測不能なので、秘匿 seed を守る工夫が不要。

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
3. **乱数は物理乱数 (kuda) を Worker が引く** → クライアントは事前に知り得ない (先読み不可)。
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
  CID 不一致ならリトライ。DO の直列化の代わりにこれで通貨の二重消費を防ぐ。

### 4.2 認証 (呼び出し元 DID) — service auth JWT
クライアントが `agent.com.atproto.server.getServiceAuth({aud: <Worker DID>, lxm, exp})` で短命 JWT
発行 → Worker が発行者 DID の署名鍵で検証。**secp256k1 は Workers の `crypto.subtle` 非対応 →
`@noble/curves` で ES256K を自前検証** (P-256 は subtle)。DID 解決は `did:plc`→plc.directory /
`did:web`→.well-known を fetch。**検証チェックリスト**: `aud`=Worker DID 厳格一致 / `lxm`=呼ぶ
メソッド / `exp`・`iat` / `iss`=解決鍵で確定 / `alg`=ES256K/ES256 のみ (alg confusion 拒否) /
リプレイは下記バトルガード・claim 冪等で実害を消す。Worker の DID は `did:web:edge.aozoraquest.app`
(edge 自身が `/.well-known/did.json` 配信)。

### 4.3 物理乱数 (kuda)
- Worker が `GET https://kuda.kojiran.workers.dev/drop` で 1 バイト (0–255, `value`) を引く。ANU
  量子乱数プール。**クライアントは介在しない** (Worker→kuda のみ) ので予測不能。
- 戦闘の各乱数消費点でバイトを引く (または戦闘開始時にまとめて N バイト引き、権威 state 側に
  秘匿保持して消費)。`drop_seq`/`batch` を監査ログに残す。
- **依存/枯渇対策**: kuda はプール有限 (`pool_remaining` 逓減)・外部依存。**kuda 応答不能時は
  fail-closed (戦闘を進めない)**。負荷が上がるならローカルの CSPRNG (`crypto.getRandomValues`)
  併用を検討 (物理乱数でなくてもサーバー秘匿なら先読みは防げる — kuda は"物理"の付加価値)。

## 5. 戦闘プロトコル (毎ターン・サーバー乱数)

**C1 (最重要)**: playerSnapshot はクライアントから受けない。encounter 時に **Worker が権威 state
(archetype/Lv/gear/baseStats/開始 HP-MP) から `startBattle` 入力を組み立てて封印**。以後は封印
snapshot のみ使い、commands 以外を戦闘計算に通さない。

**毎ターン送信** (先読み・握りつぶし・やり直しを封じる):
```
[1] POST /api/battle/encounter (JWT lxm=encounter, {x,y})
    Worker: 権威 state 読取 → 遭遇判定 → playerSnapshot 封印 → rewarded=(power>=1) 確定+予約
        → バトルガードを作成 (gameState 内 or 専用レコード: {battleId, turn:0, sealed})
        → 初期 state を返す
    ← {battleId, monster, 初期state(HP/MP), rewarded}

[2] 各ターン: POST /api/battle/turn (JWT lxm=turn, {battleId, turn, command})
    Worker: バトルガードの turn と一致を確認 (不一致=リプレイ/やり直し → 409)
        → kuda から物理乱数を引く → resolveTurn(封印state, command, 乱数) を実行
        → バトルガードを turn+1 に CAS 更新 (やり直し不可を確定) → 新 state/events を返す
    ← {state, events, outcome}
    決着なら Worker が報酬を権威 state に確定 (勝: XP+ドロップ / 負: xpLose+素材ロス、
    rewarded のみ・パワー1消費)。練習は付与も消費もペナルティも無し・記録なし。ガード削除。
```
- **先読み不可**: 乱数は毎ターン Worker が kuda から引くのでクライアントは事前に知り得ない。
- **やり直し不可**: バトルガードの `turn` を CAS で進めるので、同じターンを別コマンドで引き直せ
  ない (turn 不一致で 409)。→ 物理乱数 + turn ガードで「引き直し厳選」も「分岐総当たり」も封じる。
- **リロード離脱**: 未決着ガードは encounter 時に先に敗北 flush してから新規発行。ガードに
  `expiresAt` を持たせ、経過分は次アクセス時に lazy 敗北確定 (DO Alarm は使わない = DO 無し)。
- **並行/二重**: turn/決着は battleId+turn 一致 + swapRecord CAS で二重報酬を防ぐ。

**resolveTurn への乱数注入**: 現 `core` は seed から `turnRng` を作る。**Worker が引いた物理乱数を
毎ターン注入できるよう core に薄い口を足す** (seed 方式と両立。試練/テストは従来の seed で不変)。
レイテンシ (PDS 読書 + kuda + 往復) は DQ メッセージ送りで隠す。

## 6. XP は本番と共有 (オーナー決定 A: XP も権威化)
`analysis/self` の XP/Lv は本番カード表示でも使う。A を採る:
1. 戦闘 XP → §5 決着で権威 state に付与。戦闘入力の Lv は必ず権威値 (C1 と同原則)。
2. 投稿 XP → `/api/xp/post {postUri}`。Worker が post の実在・本人を検証して付与。**「アプリ経由」は
   ATP で原理的に検証不能**なので「本人の実在 post なら付与」に緩め、bot 稼ぎはレート制限+既存
   post-processor 分類で緩和。**冪等化必須**: 権威 state 内 `claimedPosts` に無いことを CAS で確認
   してから付与 (同一 post のリプレイ farming 防止)。クエスト報酬も一意 claim キーで二重取得封じ。
3. カード表示ミラー: 権威 Lv はサーバー。PDS `analysis` は表示ミラー。まず「クライアントが
   ミラーを書く (表示 Lv 詐称は可・実戦力は権威)」割り切り。成立条件は C1 (resolve はミラーを
   読まない)。ランキング等 (M6) の前に「Worker がミラーを書く」へ上げる。
4. 移行: 初回に PDS の現値を権威 state へ取り込むが **偽造済みかもしれない → 上限クランプ**
   (妥当上限超は切り詰め)、可能なら投稿履歴から再計算。現状 (dev=実質オーナー) は無害だが
   リリース (M5) 後の一般ユーザー移行では必ず再検討。

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
- **M3 — 戦闘の権威化**: §5 の毎ターンプロトコル (encounter/turn) + kuda 物理乱数 + core への乱数
  注入口。playerSnapshot 封印、パワー/素材/gear/戦闘 XP を権威 state に。§7 パワーモデル。
- **M4 — 投稿 XP の権威化**: `/api/xp/post` + 冪等化 + レート制限。「アプリ経由」要件緩和。
- **M5 — リリース判断**、**M6+ — 対人 (トレード #327/ランキング)**。

各 M は feature ブランチ → dev → §1.5 レビュー → dev 確認。M1 から順に。

## 9. 未解決の判断ポイント
1. **サーバーアカウント**: 依頼クエスト集約と同じ主管理者アカウントを使うか、専用ゲームアカウント
   を用意するか (権威 state の置き場)。
2. **kuda 依存**: 物理乱数を必須にするか、負荷/枯渇時は `crypto.getRandomValues` にフォールバックか
   (サーバー秘匿なら先読みは防げる。物理は付加価値)。
3. 移行の信頼方針 (クランプ/リセット)、カードミラー方針、通信断 UX (fail-closed)。

## 10. レート制限 / DoS / kuda 枯渇
service auth は本人確認まで。本人連打の DoS/無料枠食い潰しは権威 state 内カウンタで**レート制限**。
`commands`/turn 入力は長さ・値をバリデーション。日次上限リセットはサーバー時刻 (UTC/JST 固定)。
kuda は `pool_remaining` を監視し、枯渇/障害時は fail-closed か CSPRNG フォールバック (§9-2)。

## 11. 実装しない選択肢との比較
- 現状 (ユーザー PDS のまま): チート可 → リリース不可。
- **本設計 (Worker + サーバーアカウント PDS 権威 + 物理乱数 + 毎ターン + snapshot 封印)**: DO 不要・
  課金不要・ATP ネイティブ。`packages/core` 決定性と既存 edge Worker と kuda を活かす。AT Proto の
  "PDS が正本" のまま、**正本の repo をユーザーから app サーバーアカウントへ移す**のが要点。
