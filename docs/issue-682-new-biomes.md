# 雪原・雪山・砂漠 (#682)

## 承認と目的
ユーザー依頼: 新3地形の専用ドット絵を既存マップ編集で選択配置する。親の実装前承認: BASE8固定・別既知地形リスト、末尾draft追加と明示保存、雪原/砂漠は平原同等、雪山は山同等。旧マップ自動塗替え/生成変更/寒暑効果/実PDS操作/本番変更はしない。

## 操作と保存
/admin/map と /admin/interiors のパレットに絵つき「雪原を追加」「雪山を追加」「砂漠を追加」。現在のparts末尾へ1つ追加し、そのbrushを選ぶ。塗る→既存の保存→reload→Worldで配置/同梱絵/岸辺下地を確認。追加だけでは通信しない。256上限・新indexが未定義のまま既存tileやfield個別artに使用されている場合は追加を拒否し理由を表示する。既存の名前/index/parts/個別絵は不変。失敗時draftを保ち既存保存エラー表示を使う。

内部own partsはそのまま末尾追加。parts無し内部はBASE8の意味/絵/通行が完全に保たれる場合だけ明示追加時にown partsを作る: 使用indexがBASE範囲、共有partsのterrainがBASEと同一、使用indexの個別part絵が未登録。共有walkable overrideはコピーする。地形名キーの個別絵は維持。条件外は新3種追加のみ拒否し「共有パーツを使用しているため、絵や通行を変えずに新しい地形を追加する対応が必要」と表示。通常編集/保存は妨げない。このlegacy制約は親承認済み。#676の番号空間問題をschema拡張で直さない。

## データ/権威
Terrain: snowfield/snowMountain/desert。BASE_PALETTE/BASE_PARTS(index0..7)は変更しない。TERRAINS/isKnownTerrainで全既知IDを扱う。fieldのLUT、editor、NPC補助図のknown判定を更新。partsは既存のstring形式なので新schemaなし。edgeは同じcoreから読むため新coreを含むedge配備も必要（webだけ先に配備しない）。未知地形fallback自体は従来どおり。
雪原/砂漠は徒歩可、遭遇率0.05/発見率0.03（平原同等）。雪山は徒歩不可・遭遇/発見0（山同等）。既存part.walkableの明示overrideが優先。徒歩に地形別コストはなく追加しない。報酬付与処理は変更せず既存平原経路に乗る。既存生成/region集計/進捗/schema/API/権限は変更なし。

## 絵/画面
16x16オリジナル絵: 雪原は白い雪と青い吹き溜まり、雪山は白い地面に青灰の複数峰、砂漠は黄土の砂丘と風紋。palette[0]透明の既存規約。terrain既定絵を追加し個別registry優先を維持。代表色/小地図/描画fallbackも追加。岸辺は既存の隣接terrainアートclipを使う。Worldスクロールには手を加えない。

## 検証/配備境界
coreでBASE8/既存増設parts維持、新地形LUT/通行/遭遇率と旧unknown fallback。ブラウザは実editor→追加/塗る→保存/reload→World、実handleMoveの雪原/砂漠通行と雪山拒否、岸辺下地・scrollの動き。隔離transportのみ、実ユーザーPDS書込みなし。legacy安全条件/256上限も関連unit。素材/実画面を目視。必須web typecheck/build/test、関連core/edgeとE2E、lint。PR base devまで、独立review前merge禁止。実機Safari/認証済みdev gameplayは未検証と報告する。

## 実装/検証結果
- 親が上記legacy内部制限を実装前に承認。field/own-parts内部の実editor→新3種追加/配置→明示保存→reload→Worldと実handleMove成功。雪山はclient guardだけでなく直接権威呼出しでも拒否。BASE8と増設橋(index8)・個別絵・別map保持、追加時PUTなしを検証。
- parts無しの基本内部は明示追加時に安全にpartsを作れること、共有個別絵のあるlegacyは新追加だけ拒否し既存編集/保存できることも実UIで確認。edgeの実ensureAuthoredWorldでfield/内部新種レコードの読込・通行を検証。
- 素材一覧および実World画面を目視。岸辺の雪下地と既存scrollの変位→整列を確認。画像/ログはrepo外assets/aozora-biomes-682。
- 検証途中: core既存のdesert=未知を仮定したtestが失敗→未知IDをfuture-terrainに変更（fallback契約維持）。初回E2Eのdefs selectorが岸辺のnested defsにも一致→外側firstへ修正。アプリ処理の失敗ではない。最終gateはログ参照。
- 配備対象はweb + coreを含むedge-dev。edge先行で新IDを認識させ、続いてwebを配備する。旧UIは新IDを追加できないのでedge先行は安全。既存保存namespace/schemaは不変。実データ操作/本番変更なし。PRは独立レビュー待ち。
