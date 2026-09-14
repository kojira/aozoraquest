# NPCを地図で配置する / 標準アニメーション8種

Issue: https://github.com/kojira/aozoraquest/issues/667 (関連 #425 / #416)
基点: `origin/dev` = `7d29dd80e0c1ac933ba39fba2b07869147fc2872`
作業: `/Users/kojira/develop/aozoraquest-npc-map`, `feature/npc-map-placement`
状態: 設計レビューOK、実装・ローカル検証中。配備・実PDS更新なし。

## 1. 目的と確定範囲

スマホの `/admin/npcs` で座標と別画面の地図を見比べず、実マップ上の置きたいマスを押してNPCを配置できること。ユーザー添付はフィールド(212,340)のNPCが非歩行タイルに置かれ、数値入力しかない状態。

追加依頼: 男の子・女の子・若い男性・若い女性・中年男性・中年女性・おじいちゃん・おばあちゃんの8種のオリジナル待機アニメーションを選べること。

- 明示保存は維持。地図を押すだけではPDSもcoreのNPC一覧も変更しない。
- フィールド/内部マップ、未保存の他NPC、施設/入口を表示する。地形編集・ゲーム進行・認証・環境分離・NPCの自動再配置は非対象。
- 保存形式の例外は追加依頼に必要な `NpcDef.spritePreset?: NpcSpritePresetId` のみ。TileArtレコード、GameState、NPC位置の形式は変更しない。
- NPC/絵の実データ投入をエージェントが行わない。実装後のdev配備は親の既存承認/レビュー手順で別担当が行う。本番は変更しない。

## 2. 実コードとの照合と採用判断

| 現状 | 設計への反映 |
|---|---|
| `admin-npcs.tsx` の `placementError` は未知マップ・内部範囲外・facilityを保存拒否、地形/街は `placeNote` 警告のみ | **新たな位置変更**を厳しくする。既存の非歩行位置を勝手に直したり、無関係な既存NPCまで新条件で保存不能にしない |
| `setMap` は範囲外なら先頭の空きマスへ勝手に動かす | 候補マップの閲覧と位置確定を分離する |
| `setNpcs` はwrap後の同一map/同一位置を拒否 | エディタのdraft一覧でも同じwrap規則で占有判定する |
| `isWalkableAt` は保存済みNPCも障害物とする | placement用地形判定にそのまま使わない。`mappedPartAt` + `partWalkable` + `isWalkable(terrainAt)` で地形のみ、占有はdraftから判定 |
| 内部の独自partsはfield partsとindex空間が違う | `admin-interiors.tsx::partOf`と同じく独自parts時は地形キーの `pixelTile`、それ以外は `pixelPart` を使う |
| `useAuthoredWorld`/`loadAuthoredWorld` は失敗を握り潰す | この画面だけstrict読込を追加。保存地図の読込失敗を同梱mapに見せ替えて配置させない |
| `saveNpcs` はput前に `setNpcs` | pureな `validateNpcs` 抽出、検証→put→setの順に局所修正。失敗時にdraftがゲームへ漏れない |
| `TileArt`/`TileArtRecord` は静止画のみ、`world.tsx` は `pixelTile(npcArtKey(id))` | 既存frame engineはない。2枚の既存TileArtを同梱し、NPC専用のSVG表示で切替。全TileArt形式は拡張しない |

上記の位置変更と既存互換の区別、map候補方式、optional preset field/明示modeは監督と協議済み。静止画を上下移動するだけの代替や、pixel一致によるプリセット推測は採用しない。

## 3. 画面と操作

既存NPC一覧/なまえ/セリフ編集は残す。選択NPCの編集順は「なまえ → 見た目 → マップ → 配置マップ → 補助座標 → セリフ」。スマホでは1列、操作ボタンは44px以上。座標欄は折り畳み補助に下げる。

### 配置マップ

- 地図名、選択中NPC名、`タップで配置。保存するまで反映されません` を表示。
- 詳細SVGは正方形・幅100%・最大448px。1タイル32 SVG単位、初期9×9タイル。ズームは9/13/17タイル幅（狭い幅で実セル24px未満になる段階は選択不可）。内部のsizeが小さい場合はsizeまで。表示外は描画しない。
- 選択NPCは輪郭＋名前、他NPCは別輪郭と凡例。色だけで区別しない。ドラフト位置を使い、名前を地図下にも表示。地形はゲームと同じpixel art/fallback。
- 宿屋/なんでも屋/ゲート出発点は記号（宿/店/門）で重ねる。フィールド街は入口として表示。ゲート到着点と内部spawnも薄い着地点/開始地点マーカーを出すが、`facilityAt`が禁止しない着地点自体を新たな禁止条件にはしない。
- 非歩行タイルには薄い網/×、施設/占有セルには禁止マーカー。タップ時に「壁・水などで歩けない」「宿屋の入口」「○○がいる」等、優先順位付き理由を `role=status` へ出す。位置は変わらない。
- ナビは上下左右の領域移動（表示幅の半分、最低1マス）、`NPCの位置へ`、`全体図`。ドラッグによる地図パン/連続配置は実装しない。
- 全体図は**表示領域を選ぶためだけ**。タップで詳細の中心を移動し、NPC位置は変えない。フィールドは既存 `WorldMinimap` の256px canvas描画を小コンポーネントへ抽出して利用、街点と現在枠を表示。トーラス境界をまたぐ枠は分割して描く。内部は最大256pxの全域俯瞰と現在枠。内部全域が9×9以下なら詳細が全体図を兼ねる。
- `全体図は場所探し / 大きい地図で配置` と明記。フィールドは任意地域へ全体図で移動でき、座標を知る必要はない。
- フィールド表示・クリックは0..1023へwrap、内部は折返さず範囲内にviewportをclampする。

### スマホの誤操作防止

- pointerdownでは位置を書かず開始座標/scroll位置/対象map/NPCを記録する。
- pointerupで同じprimary pointer、移動距離8 CSS px以内、scroll位置不変、開始時と同じNPC/候補map、開始/終了同じタイル、対象rect内の場合だけ配置。pointercancel/2本指/スクロール/drag/外へ離す場合は取消。
- `touch-action: pan-y pinch-zoom`。preventDefaultやpointer captureでページの縦スクロールを奪わない。クリックとの二重handlerを置かない。概要図にも同じ「upまで変更なし」を適用（変更対象はviewportのみ）。
- キーボードでは地図focus後の矢印で候補カーソル、Enter/Spaceで同じvalidatorを通して配置。Tabは通常移動。候補座標と禁止理由を読み上げる。

## 4. draft・map切替・保存の状態

`load: loading | ready | error`, `save: idle | saving | error` を画面内で管理。保存成功時の一覧を深いsnapshotとして保持。`mapChoice` とviewportはUI stateのみ。

| 操作 | 結果 |
|---|---|
| NPCを選ぶ | listは維持。候補mapをそのNPCのmapへ戻し、実位置に中心を合わせる。範囲外なら見える範囲へviewportだけclampし警告。NPC自体は変えない |
| map selectorを変える | 地図だけ切替、`移動先のマスを選んでください`。NPCは元map/位置のまま、dirtyは変えない。候補mapに現在NPCを置いたようには描かない |
| 候補map上の有効tap | `{mapId,x,y}` を1回でdraft更新。fieldはmapId省略、内部はid。新しいmapの位置を選んだ後もキャンセル/取消可能 |
| `移動先選びをやめる` | mapChoiceをdraft NPCのmapへ戻す。座標/名前等には触らない |
| 同じmapの有効tap | 選択NPCのx/yだけ更新。重複と地形を再確認。他NPCの選択へ勝手に変えない |
| 補助座標 | x/yはローカル入力欄。`この座標へ移す`で整数2値を同時検証して適用。入力途中/不正値はdraftへ書かない。fieldはwrap後数値を表示 |
| `位置を戻す` | 選択時ではなく最後の保存snapshotのmap/x/yへ戻す。新規NPCは追加直後snapshotの位置へ。名前/セリフ/絵選択は維持。旧invalid位置にも戻せる |
| `未保存の変更を取り消す` | confirm後、NPC一覧全体を最後の成功snapshotへ復帰。新規/削除/絵preset選択も戻る。PDS再読込や他の絵編集保存をundoしない |
| 保存 | 未解決のmapChoiceがあれば完了/取消を促して保存しない。従来の参照/構造/配置チェック＋snapshotから位置変更したNPCのみ新配置validatorを再実行。保存中は全NPC編集/追加/削除/取消を無効化 |
| 保存失敗 | dirty/list/snapshotを維持、global NPCを変更しない。再試行は本人の保存操作のみ |
| 保存成功 | setNpcs→snapshot更新、dirty=false。既存の最大5分反映案内を維持 |
| 画面離脱 | dirty時beforeunload、画面内の管理戻りも破棄確認。外部保存済の手描き絵はNPC draftとは別と表示 |

既存NPCの不正map/range/施設重複は従来どおり保存拒否。既存非歩行/街タイルの警告のみ状態は位置未変更なら保存互換を残す。取り消し等で位置がsnapshotと同じなら新配置扱いにしない。新規NPCは保存前に新validatorを必ず通す。`+NPC`の従来仮位置は勝手に永続化しない。地図表示・未配置警告から有効タップで直せる。

## 5. 配置判定と読み込み

`apps/web/src/lib/npc-placement.ts` にpure helperを置く。inputはcandidate NPC、draft NPC一覧、保存済map資料（内部/ゲート/field地形）。出力 `{position:{mapId,x,y}} | {reason:string}`。
優先順位: 非整数→map不在→内部範囲外→施設→field街→地形→他NPC。field占有はwrap比較、同じidは除外。施設/地形は既存core関数を用い、`isWalkableAt`の保存済NPC占有を混入させない。内部独自walkable値を尊重する。NPCから隣接経路への到達性探索は非対象。

この画面のstrict loaderは既存 `getQuestAuthoringRecord` のRecordNotFound/通信失敗区別を再利用する（名称は呼出範囲に合わせ1つに統一）。対象はworldMap、tileArt、interiors、NPC、参照クエスト＋その検証に必要な既存依存。必要な依存は最新 `loadQuestAuthoringRecords` の順序を踏襲する。ゲーム用のbest-effort loaderを全画面一括変更しない。
- 全必要recordを読み、decode/構造/既存validatorの成功後のみUIをreadyにする。部分読込状態で配置・保存を許さない。error画面に再試行。
- RecordNotFound: NPC/内部/ゲート/個別絵/クエストは既存の空状態。field map未作成だけは既存同梱地図を明示して使用可（「同梱の地図」）。通信/認証/壊れたgzipは同梱にfallbackしない。
- retryは未保存編集中の自動上書きにしない。session/agentが変われば旧編集を無効化、旧async結果を捨てる。dirtyなら破棄確認後に再読込。
- pure `validateNpcs` をsetNpcsから抽出し、saveNpcsを検証→put→setへ直す。他callerの入力/保存先は不変。未知spritePreset等の型検証をここへ追加。
- 既存並行管理者更新について新しいCAS/同期機構は本件に加えない（既存の明示保存契約）。配置中に他画面のglobalが変わっても誤った絵/判定にならないよう、表示/判定は読込成功snapshotで揃える。

## 6. 標準アニメーション8種（追加依頼）

### 保存と互換

`NpcDef.spritePreset?: NpcSpritePresetId` を追加。IDは `boy/girl/young-man/young-woman/middle-aged-man/middle-aged-woman/old-man/old-woman`。省略は既存挙動、未知/空IDは保存/読込validatorで明確に拒否。文字列を勝手に他プリセットへfallbackしない。NpcDefのspreadで従来のload/save/edge通過を維持し、JSON往復テストを行う。旧レコード移行/既存NPCへの自動付与なし。

優先順位は**明示mode**:
1. spritePresetあり: 本人が選んだ同梱2frameを表示。
2. spritePresetなし: 個別 `npc:<id>` の静止絵があればそれ、無ければ従来人形。
個別絵を削除/上書きせず保持する。「手描きの絵を使う」（絵なしなら「従来の表示に戻す」）でspritePresetをunsetするdraft更新。選択をNPCの「保存」で反映。`saveTileArts`をpreset保存に呼ばない（現行は地図も書くため）。

`絵をかく`の既存エディタ/別の「絵を保存」は作り替えない。preset有効時に開いたら「標準の絵を使用中。手描きを保存した後『手描きの絵を使う』で切り替え」と表示。描き始めただけでpresetを解除しない。NPCの未保存取消で、別途保存済み手描き絵まで戻さない。

### 絵と表示

- `packages/core/src/npc-sprite-presets.ts`: 8つの名称/IDと各2枚の `TileArtRecord` を同梱。16×16、透明index0、既存64色上限内（各8〜12色目安）。既存のencode/decode/assertを利用。新しい外部画像サーバや生成サービスは不要。
- オリジナル正面待機絵。男の子=短髪/半袖、女の子=結い髪/ワンピース、若い男性=短い上着、若い女性=長髪/ベスト、中年男性=口ひげ/広い上着、中年女性=まとめ髪/エプロン、おじいちゃん=白髪/杖、おばあちゃん=白い団子髪/ショール。髪型/輪郭/小物で区別し、色だけの差分にしない。
- 2frameは目の瞬き/片腕・足の1pixel変化等、全体の上下移動だけにはしない。1.2秒周期で通常0.9秒/変化0.3秒。frame寸法・足元固定。
- `NpcSprite` SVG componentを追加。`world-tiles.tsx`のrenderArtをTileArt入力で再利用可能にし、2つのgをCSS stepsのvisibilityで切替。管理プレビュー・配置map・ゲームを同じcomponentへ。renderごとに別intervalを作らない。`prefers-reduced-motion`でframe0固定。fallback人形もこのcomponentへ移す。
- 8種の選択カードは選ぶ前から動く。各カードに名称、選択輪郭と「使用中」/「未保存」を表示。小さい48px以上のpreview。選択中NPCの地図にも即draft反映、ゲーム側はNPC保存成功後のみ変わる。

## 7. 変更箇所と検証契約

主な予定ファイル:
- `apps/web/src/routes/admin-npcs.tsx`: UI/draft状態/配置・preset操作。
- `apps/web/src/components/admin/npc-placement-map.tsx`: 地図/gesture/viewport。
- `apps/web/src/components/admin/world-minimap.tsx` + `admin-map.tsx`: 既存俯瞰の限定抽出（既存地形編集挙動は維持）。
- `apps/web/src/lib/npc-placement.ts`, `world-authoring.ts`: pure判定、strict loader/保存順序。
- `packages/core/src/npc-data.ts`, `npc-sprite-presets.ts`, `index.ts`: optional preset/validator/同梱絵。
- `apps/web/src/components/npc-sprite.tsx`, `world-tiles.tsx`, `routes/world.tsx`: 共通NPC描画。
- 上記source名に対応するunit/UI test、`apps/web/e2e/admin-npc-placement.spec.ts`。

受入:
1. 実AdminNpcs componentでfieldとふたば内部を見ながらtap→draft→明示保存→再読込が一致。NPC/地形/入口を目視できる。
2. 壁、水、custom walkable=false、宿/店/ゲート、街、draft他NPC、wrap重複、内部範囲外を拒否。保存済NPCから移動した元位置は別NPCで使用可。自分の現在位置の再選択は拒否しない。
3. map切替だけではNPC不変、取消で元表示、tapで3値同時変更。既存invalid位置は保持され修正できる。dirty/snapshot/save失敗が契約どおり。
4. 通信/認証/decode失敗→地図配置/保存不可。正しいRecordNotFoundと区別。save失敗でcore NPC不変。未知presetを黙って置換しない。
5. 390px mobile viewportで縦scroll/長いdrag/cancel/pinch/外へ離すと配置されず、短いtap1回だけ配置。全体図tapはviewportのみ。ナビは片手で押せ、下端footerと重ならない。
6. 8種×2frameはassertTileArt成功・frame間差分あり・8種が輪郭で識別可能。カード/地図/ゲームでアニメを画面確認、reduced-motion停止。
7. 既存個別絵のNPCは無変更。presetを選ぶ→保存→解除→保存で元個別絵が復帰。取消でpresetのみ巻戻し、絵レコード/地図へのputは発生しない。

必要なテストを実施する（禁止なし）。focused unit/UI→変更に応じたcore/web typecheck/test、既定build/lint/CI。実際の画面のスクショ・操作による視覚QA（8種一覧＋map＋game）を行う。ブラウザ試験では本物componentと現schemaレスポンスを使い、簡易mock画面を完成品としない。実iPhone確認は自動emulationと区別し、配備後ユーザー操作の入口を提示。PR/review用のdiffはread可能なファイルに書き出す。

## 8. 配備・復旧

この設計作業ではcode/配備なし。実装後はPR→独立レビュー→CI→devへ。coreにoptional field validation追加を含むためedge-devも対象、web/edge双方のversion確認を行う。旧workerは未知extra fieldをspread保持する現在動作をテストで確認し、先にedge-dev→web-devの順を優先。main/prod操作や既存NPCの一括変換は不要。

UI変更だけでNPCデータは変わらない。復旧はdevコードのrevert PR。保存済spritePresetは省略可能な追加属性なので、旧表示では標準絵を出せなくなるが位置・会話は保持される。ロールバックを理由にNPCや個別絵を削除しない。

## 実装時の局所修正記録

- strict読込の壊れたgzip回帰テストで `world-map.ts::through` がread例外を伝播しても、voidのwriter.write→closeが未処理rejectionを発生する事実を確認。読み込み失敗から安全に再試行する既存受入を満たすためread/write双方をPromise.allで監視する。圧縮形式、例外の意味、fallback、ユーザー操作は変更しない。focused試験で確認し、実装レビュー対象に含める。
- `loadStaticWorldMap`のcacheが別画面のactive mapを保持するため、未作成recordで他画面の地図を誤表示しないよう既存decode処理から `bundledWorldMapTiles` を抽出。strict loaderはpartsも明示snapshotへ復帰する。ゲーム側best-effort動作は維持。

## 実装・検証結果

- マップ閲覧/配置/明示保存を分離し、field・内部両方の保存→再読み込みを実AdminNpcsで確認。詳細9/13/17マス（24px未満禁止）、全体canvas、領域移動、座標補助、位置復帰、全体取消を追加。
- 8種×2frameの正面待機絵を標準選択・地図・実Worldで共用。手描き絵保持/復帰、presetだけをNPCレコードへ保存、reduced-motion停止を確認。
- 390×844 Chromium mobile emulation: 実コンポーネントと隔離PDS transport。CDPのnative touch縦スクロール、synthetic long-drag/cancel/2本指、無効地形/占有、保存中の操作、保存失敗と再試行、通信失敗と再読込、draft/global分離を確認。実iPhone・実PDSの確認ではない。
- 視覚QA: 8種カード、field配置、ふたば内部配置/操作欄、ゲームのNPCを確認。初回の選択欄のaccessible nameがoptionsを含んでいたため明示aria-labelへ修正し再検証。ゲーム画像は初回会話の暗転を閉じた状態で再撮影。
- core 825 / edge 270 tests pass。web全件は430 pass＋既存のclassName完全一致検査1失敗（admin-pageと専用classの併記を誤検知）。class token検査へ修正し当該17 tests pass。その他web失敗なし。strict-loader gzip未処理rejectionの初回失敗も前節の修正後focused 10 tests pass。
- core/edge/web typecheck、web build、validate:data、git diff --check pass。web lintは既存warningのみ。新しいNPC browser test最終1 pass（7.6秒）。全件の不要な再実行はしていない。
- 未実施: 全Playwright suite、実機Safari、実認証PDS、CI、独立実装レビュー、dev配備。既存mapエディタはrasterizer抽出のみ、操作handlerは未変更。
