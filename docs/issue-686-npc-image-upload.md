# NPC画像アップロード (#686)

## 承認・目的
ユーザーはマップ用ドット絵と会話カットイン双方のupload、規格の画面表示を依頼。初期のPNG限定・独自解析案は撤回。最新ユーザー指示「シンプルに」に従い、PNG/WebPと既存画像APIを用いる。元Bluesky参考画像の転載/切抜き/新規cut-in作画は対象外。

## 入口・規格
/admin/npcsでNPC選択。別々の「マップ画像」「会話イラスト」欄でファイル選択→プレビュー→既存の明示「保存」。PNG / WebP、透明可。GIF/APNG/animated WebP/JPEG/SVGは静止PNG/WebPへ変換が必要と明示。
- マップ: 静止16×16 / 32×32、横2コマ32×16 / 64×32。100KiB以下。左右のコマを300ms交互、reduced-motionは左コマ。コマ配置図を欄内に表示。
- 会話: 推奨512×768、必須各辺1..1024px、1MiB以下、静止PNG/WebP。縦横比維持で縮小表示（元画像のresize/減色はしない）。
選択時に容量を確認し、image-sizeの共通APIで実形式と寸法、is-animatedでファイル内アニメの有無を確認。browser Image.decodeで実際に表示できることを確認。元blobを無変換保存し透過・ピクセル・容量を保持する。metadata除去保証は撤回し、公開画像には位置情報などの付加情報もそのまま残ることを選択前に明記。EXIF等でbrowserの表示寸法が変わる場合はその寸法も検査する。

## データ・優先順位
NpcDefへ任意spriteImage/portraitImage {blob: {$type:'blob',ref:{$link:CID},mimeType:'image/png'|'image/webp',size},width,height}。省略旧レコードは無移行。coreで形式・CID・bytes・寸法を検証。
mapはupload画像>spritePreset>手描き/旧絵。preset選択/従来表示ボタンでupload画像をdraftから解除する（元pixel registryは変更しない）。画像を外す/未保存取消を明示操作にする。portraitは独立。

## 保存・認可・失敗
選択/previewだけでは外部送信しない。新画像のuploadは主管理者本人だけ（全員が読むNPCレコードが同repoにあるため）。他の管理者には選択前に理由表示し既存の画像以外の編集を禁止しない。session identityを跨ぐ非同期完了はdraftへ適用しない。
保存時はuploadBlob→成功refをNPCレコードに保持→既存saveNpcs。保存失敗はdraft/画像/成功済refを保持し再試行で二重uploadを避ける。upload成功後NPC save失敗ではblobが公開され得る。UIに公開素材・保存時送信・付加情報もそのまま公開・画像自動削除なしを明記。取消でローカルobject URL解放。実blobを自動削除しない。保存中は編集/選択不可、選択decode中も保存禁止。

## 公開配信の信頼境界
新edge GET /api/npc-image?npcId&kind&cid。公開ゲーム素材であり認証必須にはしないが、任意URL/DID/collectionは入力にしない。主管理者DID→既存resolver→HTTPS公開host PDSのみ、redirect拒否。最新保存NPCのid/kind/cid完全照合（削除/差替え旧CIDは404）、blobをpublic getBlobで取得。bounded streamで記録/画像bytesを制限、申告size一致、image-size / is-animatedの同じ共通APIで実形式・寸法・非アニメを照合し、実形式に対応したcontent-type + nosniffで返す。サーバーは展開せず、完全decode・画像の修復を保証しない。表示側の標準デコーダと失敗fallbackを使用する。独自PNG/WebP parser・CRC・inflate・行filter検査は実装しない。エラー/成功ともno-store（古いCIDや失敗をcacheしない）。NPCの参照が壊れても会話/既存fallbackを継続。

## 表示
既存NpcSpriteのSVG内imageを同じ32座標へ表示、横sheetをclipし300ms既存CSSを使う。管理previewはlocal URL、保存後/Worldはedge URL。画像失敗は旧絵fallback。
DialogueWindowに任意portraitを追加しnpcTalkのみ渡す。通常/条件別/クエストoffer・progress・reportが同経路。通知/シナリオ等には付けない。窓の上の専用領域、本文/選択肢と重ねず、短いviewportは縮小。送り面/Enter/選択/読了は既存、画像にpointer eventsなし、load失敗で画像だけ非表示。絵なし経路は従来配置。

## 検証・配備
自作PNG/WebPだけ使用。isolated transportで選択→preview（送信なし）→保存→失敗再試行→reload→実World map/NPC会話、取消/差替え/既存9preset・手描き/別NPC保持/低画面・選択肢/画像失敗を確認。core/edgeで偽ref、未保存CID、旧CID、redirect/private host、bytes/寸法/実形式/ファイル内アニメを検査。必須web typecheck/build/test、edge/core関連とbrowser。実PDS/uploadは禁止。独立review前はPR --base devまで。新core/新配信routeが必要なのでedge-dev→web-dev順、production変更なし。

## 単純化時の判断記録
親に確認し、元blobの無変換保存とmetadata除去保証の撤回を承認済み。対応ライブラリに形式差を任せ、ヘッダー/CRC/inflate自作を削除。image-sizeは完全decodeの保証ではない。is-animatedのbrowser ArrayBuffer APIを使用し、ファイル内アニメを拒否して300ms横sheet/reduced-motionと整合させる。保存形式以外の権限・ref限定配信・非同期draft保護は維持する。

ライブラリ: image-size 2.0.2（Uint8Array API、Node fs不要）とis-animated 3.0.0（ArrayBuffer API）。公開直後の最新版はrepoのminimumReleaseAgeにより採用せず、既存のリリース待機規則を維持。

## 実装・検証結果
- 外部通信遮断の実AdminNpcs/既存保存関数/WorldをPNG sprite＋WebP portrait、および逆の組合せで確認。元byte完全一致・preview alpha透明/不透明・保存前送信なし・upload失敗とNPC保存失敗後の再試行・別閲覧者・既存preset/手描き・低画面・画像失敗fallbackが成功。
- PNG/WebPの形式判定・寸法・参照・容量・ファイル内アニメは共通ライブラリ経由で確認。選択時の破損画像はブラウザdecodeで拒否。edgeでは展開しないため、従来の独自CRC/圧縮データ検査を保証とはしない。
- latest devと同一baseから継続。他worktreeや実ユーザーデータへの変更なし。edge-devで新route/coreを先に公開してからweb-devを反映する。未設定NPCは無移行で既存表示。公開されるのは保存済みNPCに紐づく参照のみ（PDS原blob自体の公開性とは別）。
- 独立レビュー・CI・配備は後続担当。認証付き実dev/iPhone Safariは未検証で、隔離Chromium成功と区別する。
