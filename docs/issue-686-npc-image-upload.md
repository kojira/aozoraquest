# NPC画像アップロード (#686)

## 承認・目的
ユーザーはマップ用ドット絵と会話カットイン双方のupload、規格の画面表示を依頼。初期のPNG限定・独自解析案は撤回。最新ユーザー指示「シンプルに」に従い、PNG/WebPと既存画像APIを用いる。元Bluesky参考画像の転載/切抜き/新規cut-in作画は対象外。

## 入口・規格
/admin/npcsでNPC選択。別々の「マップ画像」「会話イラスト」欄でファイル選択→プレビュー→既存の明示「保存」。PNG / WebP、透明可。GIF/APNG/animated WebP/JPEG/SVGは静止PNG/WebPへ変換が必要と明示。
- マップ: 静止16×16 / 32×32、横2コマ32×16 / 64×32。100KiB以下。左右のコマを300ms交互、reduced-motionは左コマ。コマ配置図を欄内に表示。
- 会話: 推奨512×768、必須各辺1..1024px、1MiB以下、静止PNG/WebP。縦横比維持で縮小表示（元画像のresize/減色はしない）。
選択時に容量を確認し、image-sizeの共通APIで実形式と寸法、is-animatedでファイル内アニメの有無を確認。browser Image.decodeで実際に表示できることを確認。最新の追加指示「全部WebP」に従い、新たに選択する保存用画像はすべてimage/webp。既存依存@jsquash/webp（libwebp WASM）で同寸変換し、spriteはlossless:1/exact:1/near_lossless:100、portraitはquality:85/alpha_quality:100。canvas.toBlob品質1をロスレスとは扱わない。既存WebPが変換結果より小さく同寸なら、再劣化・肥大化を避け元WebPを使う。出力形式/寸法/bytes上限を再確認し、変換後画像と入力→出力容量をpreviewして明示保存。元ファイルは不変。リサイズ/圧縮率の自動試行はしない。再encodeでは元のEXIF等を渡さないが、小さい元WebPを再利用する場合は付加情報も残り得る旨を表示。

## データ・優先順位
NpcDefへ任意spriteImage/portraitImage {blob: {$type:'blob',ref:{$link:CID},mimeType:'image/png'|'image/webp',size},width,height}。省略旧レコードは無移行。coreで形式・CID・bytes・寸法を検証。
mapはupload画像>spritePreset>手描き/旧絵。preset選択/従来表示ボタンでupload画像をdraftから解除する（元pixel registryは変更しない）。画像を外す/未保存取消を明示操作にする。portraitは独立。

## 保存・認可・失敗
選択/previewだけでは外部送信しない。新画像のuploadは主管理者本人だけ（全員が読むNPCレコードが同repoにあるため）。他の管理者には選択前に理由表示し既存の画像以外の編集を禁止しない。session identityを跨ぐ非同期完了はdraftへ適用しない。
保存時はuploadBlob→成功refをNPCレコードに保持→既存saveNpcs。保存失敗はdraft/画像/成功済refを保持し再試行で二重uploadを避ける。upload成功後NPC save失敗ではblobが公開され得る。UIに公開素材・保存時送信・付加情報が残る場合もある・画像自動削除なしを明記。取消でローカルobject URL解放。実blobを自動削除しない。保存中は編集/選択不可、選択decode中も保存禁止。

## 公開配信の信頼境界
新edge GET /api/npc-image?npcId&kind&cid。公開ゲーム素材であり認証必須にはしないが、任意URL/DID/collectionは入力にしない。主管理者DID→既存resolver→HTTPS公開host PDSのみ、redirect拒否。最新保存NPCのid/kind/cid完全照合（削除/差替え旧CIDは404）、blobをpublic getBlobで取得。bounded streamで記録/画像bytesを制限、申告size一致、image-size / is-animatedの同じ共通APIで実形式・寸法・非アニメを照合し、実形式に対応したcontent-type + nosniffで返す。サーバーは展開せず、完全decode・画像の修復を保証しない。表示側の標準デコーダと失敗fallbackを使用する。独自PNG/WebP parser・CRC・inflate・行filter検査は実装しない。エラー/成功ともno-store（古いCIDや失敗をcacheしない）。NPCの参照が壊れても会話/既存fallbackを継続。

## 表示
既存NpcSpriteのSVG内imageを同じ32座標へ表示、横sheetをclipし300ms既存CSSを使う。管理previewはlocal URL、保存後/Worldはedge URL。画像失敗は旧絵fallback。
DialogueWindowに任意portraitを追加しnpcTalkのみ渡す。通常/条件別/クエストoffer・progress・reportが同経路。通知/シナリオ等には付けない。窓の上の専用領域、本文/選択肢と重ねず、短いviewportは縮小。送り面/Enter/選択/読了は既存、画像にpointer eventsなし、load失敗で画像だけ非表示。絵なし経路は従来配置。

## 検証・配備
自作PNG/WebPだけ使用。isolated transportで選択→preview（送信なし）→保存→失敗再試行→reload→実World map/NPC会話、取消/差替え/既存9preset・手描き/別NPC保持/低画面・選択肢/画像失敗を確認。core/edgeで偽ref、未保存CID、旧CID、redirect/private host、bytes/寸法/実形式/ファイル内アニメを検査。必須web typecheck/build/test、edge/core関連とbrowser。実PDS/uploadは禁止。独立review前はPR --base devまで。新core/新配信routeが必要なのでedge-dev→web-dev順、production変更なし。

## 最新指示と単純化の判断記録
PNG限定と自作解析は撤回済み。後から受領した「容量食うから全部WebP」指示を優先し、元blob保存だけの案を撤回。入力PNG/WebP→既存encoderで保存用WebP→変換後preview→明示保存とする。既存画像の一括変換/実PDS変更はしない。小さい元WebPの再利用を除きmetadataはImageDataからのencodeに渡さない。metadata完全除去を一律保証しない。

image-size 2.0.2（Uint8Array API）、is-animated 3.0.0（ArrayBuffer API）で既存の共通検証。WebP encoderはwebに既に存在する@jsquash/webp 1.5.0を使い追加依存なし。serverは完全decode/無害化を保証せず、独自PNG/WebP parser/CRC/inflateを実装しない。

## 検証・受渡し
実AdminNpcs/保存関数/Worldの隔離transportでPNG/WebP入力、出力WebPのdecode・alpha・sprite画素一致、保存前送信なし、upload/NPC保存失敗再試行、reload、別viewer、preset/手描き保持、低画面、画像失敗fallbackを確認する。spriteロスレスとportraitの画質/bytesを自作画像で確認。認証付きdev/iPhone Safariは未検証であり隔離Chromiumとは区別。独立review/CI成功後、新route/coreのedge-dev→web-dev順で配備。今回workerはPRまで。


## WebP変換の実測
- 既存@jsquash/webp WASMを実browserで使用。Vite dev最適化で既定wasm URLがHTMLを取得して初回失敗したため、本機能のloaderでbundled wasmを`?url`で明示し、dev/本番hash asset双方に対応。既存投稿用の処理は変更していない。
- 既存同梱sprite-sheet 64×32: PNG956bytes→WebP490bytes。デコード後のRGB全channelとalphaが一致。
- 過去の自作カットイン試作512×768（ユーザー提供画像ではない）: PNG199602bytes→quality85 WebP40112bytes。alpha差0、opaque RGB平均絶対差2.04/255。比較画像を目視し、顔・線・色の可読性を維持して約80%削減できたため品質85を採用。元画像を変更/公開せずローカルQCだけに使用。
- 既に小さいWebPは再encode結果より小さいと元bytesを使う回帰を追加。入力形式にかかわらず保存ref/mime/公開edge responseはWebP。既存保存PNG参照は互換性のため引き続き読めるが、一括書換えはしない。
