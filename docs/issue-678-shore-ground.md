# #678 岸辺の隣接下地

## 承認・目的
ユーザー承認: 周囲の地形の実絵を下地にして水際を重ねる。固定草や砂漠専用分岐にしない。前実装の草固定を直す。入口は既存 /admin/map、/admin/interiors の標準海/池を塗る→明示保存→reload→World。新UI/新地形は追加しない。

## 設計（実装前）
- 47形の水接続mask・形状は維持。quarter原画の g/e（旧草/土領域）は透明な下地窓にし、泡/浅瀬/水面を上に描く。固定緑・茶で隣接陸のpaletteを上書きしない。
- 各quarterの参照元: 一方の辺だけ陸ならその辺、両辺が陸なら画素から近い辺（同距離は上下辺）、両辺が水で斜めだけ陸なら斜め。水/池/橋と内部範囲外は陸に選ばない。これで混在岸も決定的に接続する。
- 下地は隣接セルと同じ通常描画関数（field=part絵優先、独自parts内部=terrain絵のみ）を使用。水セル内では同じタイル座標で絵を繰り返し、回転/反転/低解像度化/パレット再量子化しない。8/16/32画素・透明画素もそのまま。岸の窓をSVG clipPathで切り、元の絵の上に透明な水際原画を重ねる。
- mask別の窓形状/overlayだけをcache。合成した陸絵はcacheしない。defsのキーはmaskに加え8近傍の実描画識別（part index/terrain、内部はterrain）を含める。各clipPath idは親defs idから導出し異なる岸で衝突させない。
- fieldのcells memoのtab依存を保持し、絵保存・同梱復帰で再評価。描画時にregistryを読むので下地の絵更新も拾う。
- field座標はwrap、内部端は水の継続。内部editorの既存fallback、独自partsの番号空間契約を保つ。Issue676を修正しない。

## 不変・対象外
map/TileArt保存形式、通行、生成、権限、保存API/失敗/競合/再試行は変更なし（表示のみのため新APIや移行不要）。個別水artは最優先でauto対象外。ユーザーPDS/NPC/進捗/村/本番を書換えない。砂漠・雪原の地形を追加しない。fixtureでplains型の自作砂/雪風parts、terrain絵を使って将来追加時の一般性を示す。NPC補助図/全体図は対象外。

## 受入・検証
- 単独池/凹凸角/細水路/橋と草砂雪混在を画像確認。砂/雪の岸に固定緑を残さない。陸の絵/色をそのまま描く。
- 同maskで異なる陸partsがある画面でdefsが混線しない。quarter選択をunitで確認。
- 実field/internal editorの塗る→明示保存→reload→World回帰。外部通信遮断fixtureでtiles/parts/別map保持、保存前put無し。前P1の絵保存/同梱復帰→タブ復帰も維持。
- 必須typecheck/build/web unit、関連Playwright、lint。失敗履歴保存。比較画像を目視。
- 認証付き実dev操作/実機Safariは未検証として明記。独立レビュー待ちPR(dev向け)まで、merge/配備は後続。

## 実装・検証記録
- 実装は上記設計どおり。quarterの窓はmaskだけ、下地は毎回通常描画関数で解決する。cacheへ登録アートを保存しない。
- 隔離E2E: 独自parts内部にterrainキーの砂風絵、fieldにpart:10砂/part:11雪（32px）を登録。fieldは1023↔0境界、橋、同mask/同水partの砂池と雪池を同画面に置き、別々の下地で表示。塗る→保存→reload→Worldで下地/clip/overlayのSVG構造が一致。SVG idの画面固有prefixだけ比較時に正規化する（画面全体のpixel比較ではない）。
- 個別水art保存→地図タブ復帰、同梱復帰→地図タブ復帰の回帰も保持。保存前put無し、別map/parts/tiles不変を確認。
- unit435/435、関連Playwright3/3、typecheck/build成功。lint0errors/既存24warnings。今回テスト失敗なし。
- 画像をreadで目視: 草地/砂風/雪風/混在、丸角/単独池/入り江/細水路。砂/雪の水際に固定緑なし。実World内部も砂風下地で表示。素材例であり砂漠/雪原地形を実装したものではない。
- 証跡: `/Users/kojira/develop/pi-work/assets/aozora-shore-ground-678/`。認証付きdev・実PDS操作・iPhone/Safariは未実施。独立レビュー待ち。
