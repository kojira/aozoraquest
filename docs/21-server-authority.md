# 21. あおぞらワールドのサーバー権威化 (チート対策) — 設計 v2

**状態**: 設計提案 (未実装)。§1.5 の 3 観点レビュー (設計/セキュリティ/実装可能性) を反映済み。
オーナー承認後に実装 (M1) へ。
**背景**: あおぞらワールドの戦闘・報酬・パワー・素材・XP は現状すべて **クライアントで計算し
ユーザー自身の PDS レコードに書く** ため、その気になれば自分の記録を偽造できる。オーナー
言明「チートできる design は望んでいない = チートできる状態ではリリースできない」。本書は
それを非チート化する設計。

参照: [[19-overworld]] (W3 当初メモ・**毎ターン送信プロトコル**), [[02-architecture]] (要更新), [[18-brusukon-trial]]。
**レビュー反映**: 3 観点 (設計/セキュリティ/実装可能性) の ★★★/★★ をすべて本文に落とした。

---

## 1. 脅威モデル

- 報酬の偽造 (戦わず/負けたのに XP・素材・パワーを得る)。
- **playerSnapshot 詐称** (盛ったステ/装備/レベルで戦って確定勝利)。← 最重要 (§5.C1)。
- **seed 先読み** (seed 既知なら `turnRng` が turn 番号だけで決まるため、全コマンドを総当たり
  して確定勝利・確定ドロップを狙える。§5.C3)。
- **投稿 XP のリプレイ** (同一 post を何度も claim して XP farming。§6.2)。
- リロード離脱で敗北回避、複数端末の二重 resolve/二重報酬、上限回避、DoS/無料枠食い潰し。

スコープ外: 気質診断 (自己表現でチートの旨味が薄い)。本書は「ゲーム経済 (パワー・XP・素材・
進行) の権威化」に絞る。

## 2. 根本原因

権威データ = ユーザー自身の PDS repo のレコード。AT Protocol ではユーザーは自分の repo に
自由に書けるので偽造できる。→ **ゲーム経済の権威データをサーバー管理ストアへ移す**。
チート対象レコード: `power/self`, `analysis/self` (XP/Lv), `battle/*`, `world/self`,
`gear/self`, `craft/*` (すべてクライアントが `putRecord`)。

## 3. 設計原則

1. 権威データはサーバー管理ストア (ユーザー PDS から直接書けない場所) に置く。PDS には表示用
   read-only ミラーを置いてよいが正本はサーバー。
2. **サーバーが戦闘を解決** する。`packages/core` は決定的・環境独立 (`createRng` は V8 で完全
   決定的、レビュー確認済み) なので Worker で同じエンジンを使える。
3. **seed はサーバー発行かつサーバー秘匿** (クライアントに渡さない → 先読み不可)。
4. **戦闘への入力はクライアントからは commands のみ**。ステ/装備/レベル/HP/MP は DO 権威値のみ。
5. 呼び出し元 DID をサーバーが検証 (自分の状態しか触れない)。
6. **fail-closed**: 認証失敗・DID 解決失敗・PDS 取得失敗・通信断は「報酬を与えない」方向に倒す。

## 4. アーキテクチャ

### 4.1 コンポーネント
- **`apps/edge` Worker (既存)** に `/api/*` を追加。`@aozoraquest/core` を import して戦闘解決。
- **`PlayerDO` (Durable Object, per DID, `idFromName(did)`)** = 権威ストア。保持:
  - あおぞらパワー残高、冒険 XP/レベル (playerLevel/jobLevel)、**素材インベントリ + 装備 gear**
    (gear は戦力直結なので必ず権威側)、位置・解禁リージョン、日次カウンタ。
  - **進行中バトル**: `{battleId, seed(秘匿), monsterDef, playerSnapshot(DO権威で封印), rewarded,
    reserved(消費予約), turnLog, expiresAt}`。
  - **claimedPosts**: 投稿 XP を払い済みの post キー集合 (冪等化)。
  - **claimedQuests**: クエスト報酬の一意 claim キー集合。
  - **nonce/jti 短期記録** (JWT リプレイ拒否)。
  - **なぜ DO**: per-DID の直列一貫性 (通貨の二重使用防止・進行中バトルロック・複数端末) が要件。
    D1 だと悲観ロックを自前で書く羽目になる。**DO で確定** (§9 から DO/D1 の問いは落とす)。
  - **レシート署名方式 (全ステートを DO に持たず署名レシートを PDS に書かせる) では不十分**:
    署名レシートを 2 端末で同時提示する残高の二重使用を防げない → DO 直列化が要る。
  - **DO 内 critical section 中に外部 fetch (PDS 取得等) を挟まない** (Cloudflare DO は storage
    I/O 中に input gate が開き別リクエストが割り込む)。外部取得が要る場合は取得後に state を
    再検証してから確定する。
- **プラン前提**: DO は **Workers Paid ($5/月〜)** が必要 (§9 の判断事項)。

### 4.2 認証 (DID 本人確認) — service auth JWT
`@atproto/oauth-client-node` は Workers 非互換 (edge の probe 済み)。per-user は **AT Protocol の
service auth (inter-service JWT)** を使う。クライアントが `agent.com.atproto.server.getServiceAuth
({ aud: <Worker DID>, lxm: <呼ぶメソッド>, exp })` で短命 JWT を発行 → Worker が発行者 DID の
署名鍵で検証。

**実装上の現実 (実装可能性レビュー ★★★)**:
- **secp256k1 は Web Crypto 標準外**。Workers の `crypto.subtle` は P-256/384/521 のみで、AT Proto
  鍵の**大半が secp256k1 (ES256K)**。→ **`@noble/curves/secp256k1` を edge に追加して自前検証**
  (純 JS・依存ゼロ・Workers 実績)。P-256 (ES256) のみ subtle。JWT パース・base64url・did:key
  multibase デコードも自前 (数十行)。**M1 の実体はこの検証 PoC**。
- DID document 解決: `did:plc` → `https://plc.directory/{did}`、`did:web` →
  `https://{host}/.well-known/did.json` を `fetch`。取り出した verificationMethod の公開鍵で検証。
  **解決結果をキャッシュするなら TTL + 失効** (did:plc の鍵回転に追従)。

**JWT 検証チェックリスト (M1 の受け入れ条件。セキュリティ ★★ H1)**:
- [ ] `aud === Worker の DID` を厳格一致 (他サービス宛 JWT の流用拒否)。
- [ ] `lxm === 呼び出し先メソッド` (エンドポイント越境の流用拒否。**encounter/各ターン/xp claim
      でそれぞれ別 lxm・別 JWT**。getServiceAuth の JWT は寿命が数十秒なので戦闘を跨げない →
      **ステップごとに取り直す**)。
- [ ] `exp` 必須・時計スキュー許容明示、`iat` 過去妥当性。
- [ ] `iss` を解決した鍵で検証し、**確定 DID = iss** (ヘッダの鍵を信じない)。
- [ ] `alg` は ES256K/ES256 のみ許可 (`none`・想定外 curve 拒否 = alg confusion 対策)。
- [ ] リプレイ: `jti` or `(iss,iat,lxm)` を DO で短期記録し二重使用拒否。実害は resolve/claim 側
      の冪等性 (§5.H3 / §6.2) でも消えるが、二重の守り。

### 4.3 seed 発行 (サーバー秘匿)
- 遭遇成立時に Worker が `seed32 = to32(HMAC-SHA256(KEY_SECRET, structured(did, battleCounter)))`
  を発行し **DO 内に秘匿保存** (クライアントに返さない)。`KEY_SECRET` は Worker Secret。
- `structured(...)` は **長さ prefix or 区切りで did と counter の境界を曖昧にしない** (連結衝突
  対策)。`to32` は HMAC 出力の先頭 4 バイトを uint32 化する **固定規則** (web/Worker で一致、テスト
  固定)。※ core の `createRng` は 32bit seed を取る。
- `battleCounter` は **DO で 0 起点・単調増加**。移行時 (§6.4) に PDS の battle 数から初期化しない
  (偽造値経由の seed farming 入口を塞ぐ)。**encounter で採番と同時にインクリメント確定** (棄権でも
  消費 → 同一 seed の再取得不可)。

## 5. 戦闘プロトコル (毎ターン・サーバー秘匿 seed)

**中核前提 C1 (セキュリティ ★★★)**: playerSnapshot はクライアントから受け取らない。encounter 時に
**DO が自分の権威データ (archetype/playerLevel/jobLevel/gear/baseStats/開始 HP-MP) から
`playerCombatant`/`startBattle` の入力を組み立てて封印**する。以後 resolve/各ターンは DO 封印の
snapshot のみを使い、**commands 以外のクライアント入力を戦闘計算に一切通さない**。開始 HP/MP
(戦闘をまたいで持続する設計) も snapshot に含める (決定性の根幹)。

**C3 (seed 先読み対策) → 毎ターン送信プロトコル** (当初 docs/19 §4 が正、v1 の一括方式は退化):
```
[1] POST /api/battle/encounter  (JWT lxm=encounter, {x,y})
    DO: 進行中バトル無しを確認 → 遭遇判定 → seed 採番(秘匿) → monster 確定
        → playerSnapshot を DO 権威値で封印 → rewarded=(power>=1) を確定し消費を予約(reserve)
        → 進行中バトル記録 (expiresAt 設定)
    ← {battleId, monster(表示用), 初期state(HP/MP), rewarded}   # seed は返さない

[2] 各ターン: POST /api/battle/turn  (JWT lxm=turn, {battleId, command})
    DO: battleId 一致確認 → resolveTurn(封印state, command) を DO 内で実行 (seed 秘匿のまま)
        → 新 state と events を返す。クライアントはこれを描画 (seed を知らない=先読み不可)
    ← {state, events, outcome}
    outcome が決着なら DO が報酬確定 (下記) してバトルをクローズ。
```
- **握りつぶし不可**: 各ターンの RNG は DO 側だけが持つ seed で決まり、クライアントは結果を見て
  から手を選べない。負ける展開を握りつぶして別 battleId に逃げることもできない (encounter は
  「未解決バトルを先に敗北 flush」してからでないと新規発行しない)。
- **決着時の報酬 (DO)**: rewarded かつ勝/負なら報酬適用 (勝: XP+ドロップ / 負: xpLose+素材ロス)
  し予約したパワーを消費。練習 (rewarded=false) は付与も消費もペナルティも無し・記録も残さない。
- **リロード離脱 (H2)**: 未解決バトルは **encounter 要求時に必ず先に敗北 flush** + `expiresAt`
  経過分は **DO Alarm** で能動確定 (DO はハイバネ中 compute しないので、時刻経過の自動処理は
  Alarm を使う)。expiresAt は短く。予約したパワー/ロスは encounter 時 reserve で hold し、棄権
  でも二重消費/消費逃れが起きないようにする。
- **二重 resolve/並行 (H3)**: turn/決着は「battleId が現在の進行中と一致」を条件にし、不一致は
  409。DO 直列化で二重報酬を防ぐ。

**レイテンシ**: 毎ターン ~50-150ms の往復は DQ 風メッセージ送り (タップで次) の間に隠す。通信断は
fail-closed (報酬なしでバトル無効、再開時にサーバー state を正とする)。

## 6. XP は本番と共有 (オーナー決定 A: XP も権威化)

`analysis/self` の XP/Lv は本番のカード表示・診断・レベリングでも使う。A を採るので:

1. **戦闘 XP** → §5 の決着で DO 付与。**戦闘入力の Lv は必ず DO 値** (クライアント申告 Lv を戦闘
   計算に流さない。C1 と同原則。§6.3 ミラーの成立条件でもある)。
2. **投稿 XP** → 投稿でも Lv XP が入る (`post-processor` が加算)。`/api/xp/post {postUri}` で Worker
   が付与。**「アプリ経由か」は AT Proto では原理的に検証不能** (どのアプリ製かの偽造不能な署名が
   無い) → 要件を **「本人の実在 post なら付与」に緩め**、bot 大量投稿は**レート制限 + 既存
   post-processor の内容分類**で緩和。冪等化必須 (C2): DO の `claimedPosts` に無いことを atomic に
   確認してから付与。post rkey 単位で恒久ロック (delete→再 create の別 CID を弾くか rkey 恒久かは
   実装時に確定)。クエスト報酬も `claimedQuests` で二重取得を封じる。
3. **カード表示ミラー**: 権威 Lv は DO。PDS `analysis` は表示ミラー。
   - (ii) クライアントがミラーを書く割り切り = **表示 Lv 詐称は可だが実戦力はサーバー権威**。
     **成立条件は C1 (snapshot が DO 権威値のみ・resolve はミラーを読まない)**。まずは (ii)。
   - **ランキング/マッチング等で表示 Lv を使う段階 (M6) の前に (i) (Worker が PDS ミラーを書く、
     ユーザーが write scope を OAuth 同意) へ上げる**。
4. **移行 (H4)**: 初回ロードで PDS の現値を DO に取り込むが、**PDS 値は偽造済みかもしれない**。
   そのまま正本化すると偽造値のロンダリングになる。→ 移行は **信頼せず上限クランプ (妥当上限超は
   切り詰め)**、可能なら post 履歴から再計算。**現状 (dev=実質オーナー) は無害だが、リリース (M5)
   後の新規/既存ユーザー移行では必ず再検討** (self-contained に両者を分けて記録)。

## 7. パワーモデル (DO で enforce)
オーナー要望「歩く消費は廃止 / パワー無しは勝敗どちらも何も貰えない (シンプル)」を DO で:
歩く・遭遇・戦闘は自由。encounter 時に DO が `rewarded=残高>=1` を確定し消費を reserve。決着で
rewarded かつ勝/負なら報酬 + パワー1消費、練習は付与も消費もペナルティも無し・記録なし。判定を
DO が持つのでチート不可。(クライアント側 WIP は `feature/power-model-simplify` に退避、M3 で作り直す。)

## 8. マイルストーン計画

- **M0 (本書)**: 設計合意。
- **M1 — 認証基盤 (実体は crypto)**: (a) **`@noble/curves` 等で ES256K/ES256 JWT 検証 + DID 解決の
  PoC** (oauth-probe と同枠で import 互換を最初に確認)、(b) §4.2 チェックリスト全項目、(c) edge に
  `did:web:edge.aozoraquest.app` を持たせ `/.well-known/did.json` を edge 自身が配信 (web SPA
  ルーティングと衝突させない)、(d) `/api/whoami` (JWT→DID)。**併せて docs/02 に「edge Worker と
  ゲーム経済 DO は "サーバー層なし" 原則の例外」を追記** (設計 ★★-5)。本番影響ゼロ。
- **M2 — PlayerDO + 読取 + core smoke**: DO 追加 (Workers Paid 前提)。`@aozoraquest/core` を 1 関数
  import して `wrangler deploy --dry-run` が通ることを最初に smoke (raw TS 配布・`world-data`
  芋づるのバンドルサイズ・subpath export 要否を確認)。初回アクセスで PDS 現値を**クランプして**
  DO に取り込み (§6.4)、`GET /api/me/state` (JWT 必須・自分のみ) で返す。**合格条件は
  「スナップショット取込が正しい」ことだけ** (PDS は LWW ドリフトで自己矛盾しうるので恒久一致は
  求めない。取込後は DO を正、PDS 突合は監査線)。
- **M3 — 戦闘の権威化**: §5 の毎ターンプロトコル (encounter/turn)。seed 秘匿、playerSnapshot を DO
  権威で封印、パワー/素材/gear/戦闘 XP を DO 正本。§7 パワーモデル。**戦闘経由のチートを封じる。**
- **M4 — 投稿 XP の権威化 (独立の大物)**: `/api/xp/post`。post 実在・本人検証 + **冪等化 (C2)** +
  レート制限。「アプリ経由判定」は原理不能なので要件緩和 (§6.2)。M3 と同等以上の重み。
- **M5 — リリース判断**: 経済+XP 非チート化 → world 本番リリース可否。
- **M6+ — 対人**: トレード (#327) / ランキング。前に §6.3 を (i) に上げる。M1–M4 が前提。

各 M は feature ブランチ → dev → §1.5 レビュー → dev 確認。M1 から順に。

## 9. 未解決の判断ポイント (オーナー確認)

1. **課金**: DO は Workers Paid ($5/月〜) が要る。契約してよいか (無料枠では DO 不可)。
2. **戦闘プロトコル**: 毎ターン往復 (安全・レイテンシ有、推奨) で確定してよいか。一括方式は seed
   先読み・握りつぶしで破れるため非推奨。
3. **移行の信頼方針**: 既存 PDS 値をクランプ取込か、リセットして再取得か。
4. **カードミラー**: まず (ii) 割り切り (表示 Lv 詐称可) でよいか。M6 前に (i) へ。
5. **通信断 UX**: fail-closed (バトル無効・再開でサーバー正) の体感で問題ないか。

## 10. レート制限 / DoS (設計 ★★-6, セキュリティ P3)
service auth は本人確認までで、**本人が自分の DO を高頻度連打する DoS / 無料枠食い潰し**は防げない。
DO 内に**汎用レートリミット** (分次/日次カウンタ) を持つ。`commands`/turn 入力は**長さ・値を
バリデーション** (未定義 command で core が想定外挙動しない・巨大入力で CPU を焼かない)。日次上限の
**リセット基準はサーバー時刻 (UTC/JST 固定)**、クライアント時計で日付境界を判定しない。

## 11. 実装しない選択肢との比較
- 現状 (PDS のまま): 実装ゼロだがチート可 → リリース不可。
- クライアント難読化のみ: 気休め、決定的に破られる。
- レシート署名方式: 残高の二重使用を防げない (§4.1)。
- **本設計 (毎ターン・サーバー秘匿 seed・DO 正本・snapshot 権威化)**: `packages/core` 決定性と既存
  edge Worker のおかげで現実的。AT Proto の "PDS が正本" から**ゲーム経済だけ "サーバーが正本"** に
  ずらすのが要点。
