# #684 BlueskyちゃんのNPCドット絵

## 承認範囲と利用体験
ユーザー提供のキャラクターを、管理 `/admin/npcs` の「標準の絵」で **Blueskyちゃん** として選択→プレビュー→明示「保存」→reload/Worldで表示できる1プリセットにする。NPCの新規配置・台詞・ストーリー・会話カットインは対象外。参照の箱/背景/文字を転載しない。

## 実装前設計
- `bluesky` を既存 `NPC_SPRITE_PRESET_IDS` とpreset配列の末尾へ追加。validatorはこの一覧を共用するため新IDが通る。保存schema/データ移行/新APIなし、既存8種は変更しない。
- 大きな淡緑帽子と広いつば、空色長髪・巻き前髪・雲風ハイライト、淡緑トップスと紺ボトムを独自シルエットで描く。16pxでは巻き髪とつばの細部を潰すため、既存TileArtが許可しrenderArtが32座標へ等倍描画できる32×32を使用する。renderer/キャラ表示領域は変更不要。靴は控えめな暗色。
- 二コマとも頭/顔/胴の位置は固定、左右の手と足だけ前後を交互にする。既存NpcSprite/CSSの300ms/コマ、reduced-motionの先頭静止をそのまま使用。blink/bobを追加しない。
- 個別NPCアートは既存の明示preset優先/手描き復帰契約のまま。選択はdraft、失敗時draft保持、保存先/権限/競合処理は既存に従い変更しない。未指定NPCの自動置換なし。
- 同じ原画から透明PNG各コマ/横sprite sheet、等倍とnearest拡大の比較、通常速度GIFを生成。`apps/web/public/art/bluesky-npc/`で完成spriteのみ公開可能にする（参照画像は置かない）。生成スクリプトは原画を読んで出力し、画像との二重編集を避ける。
- edgeもsetNpcs/validatorを使うため、新coreを含むedge-devをweb-devより先に配備する必要がある。今回はPRまでで配備しない。

## 受入・検証
参照画像とPNG/GIFをreadして、元キャラの髪/帽子の輪郭・色が実32pxでも識別可能か評価。coreは既存8種不変を維持し新32pxの顔固定/左右手足の差と透明画素・validate/roundtripを確認。既存実AdminNpcs隔離E2Eの選択を新presetへ拡張し明示保存/reload/World・手描き復帰・全9種animation/reduced-motionを確認。edge authored loaderで新IDと旧NPCが共存して読み込めることを確認。webの必須typecheck/build/test、関連core/edge testとlint。ブラウザは隔離transportで、認証済dev/実機Safari受入と混同しない。

## 保存・安全
実PDS/NPC位置/村/プレイヤー進捗に触れない。main/dev直接変更や配備なし。レビュー後のdev配備は後続工程。元画像の公開/会話cut-in追加は今回行わない。

## 実装結果・確認境界
`bluesky` の32px原画を追加し、既存8種/renderer/CSSは変更していない。PNG/GIFは `python3 scripts/export-bluesky-npc.py`（Pillow必要）で同じゲーム原画から出力。`/art/bluesky-npc/comparison.png` と `/art/bluesky-npc/walking.gif` はweb配備後に公開できる。原寸/拡大比較と実Worldで緑帽子・巻き前髪・長い髪を目視し、単なる色替えではないことを確認した。

web typecheck/build/test444、core837、edge authored loader6、lint0 errors（既存24 warnings）成功。実390px AdminNpcsの隔離回帰で9カード、Bluesky選択→プレビュー→明示保存→reload→World、旧NPC/preset保持、手描き復帰、全9種300ms交互表示/reduced-motionを確認。生成GIFも300ms/コマで顔/帽子は固定。最初のカード画像は固定footer/headerが重なったため撮影スクロール位置だけ調整し、最終画像をread確認した。アプリコードの問題やテスト失敗ではない。

認証付きdev・実機Safariは未検証。参照画像の再配布なし。既存NPC/台詞/配置の書込みなし。独立レビュー/最新CI成功後、後続担当が新coreのedge-devを先行、続いてweb-devへ配備する。今回PRまでで止める。

## 後続要件: 会話カットイン（別案件・未実装）
制作中にユーザーから「会話する時はカットインイラストを出せるように」と追加要望。親の最新判断は、完成したドット絵を先に見せ、本PRのreview/配備は止めない。カットインは別PRで範囲を整理する。**元画像は参考限定で切抜き/転載不可**。立ち絵の新規制作/公開も未承認のため行わない。

現物: `DialogueWindow` はplateIconのみでportraitなし、`NpcDef`に画像属性なし。任意画像の管理/保存/配信経路を新たに決める必要がある。投稿用uploadBlobの単純流用はしない。

未承認の最小案: NPCのspriteとは独立した任意portrait指定、管理画面で選択/会話プレビュー→明示保存。会話窓の上に専用表示領域を設け文面/選択肢と重ねず、小画面は縮小。画像失敗は会話継続、既存タップ/Enter/読了で閉じる、絵なしNPCは従来表示。今回の画像を参考に新規の上半身絵を作る案はあるが、制作前に範囲を承認すること。固定同梱presetだけでは「任意NPCへ画像を設定」の一般機能より狭いため、任意ファイルの保存方法/管理入口を含めユーザーとの整理が必要。NPC実データ書込み/新ストーリー追加は禁止を維持する。
