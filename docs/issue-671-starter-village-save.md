# #671 内部マップの読込で同梱村の下書きが戻る

## 症状と再現
ユーザーはふたばの村を保存したのに、クエスト画面で旧版64×64と拒否された。

- 基準dev: `74ee0bca056b00829e68021a0d591bb2a5f47488`。
- 読取のみで実dev bundleを確認。標準村関数はすでに32×32。実管理レコードはふたば64×64、updatedAt `2026-09-15T00:23:10.967Z`。クエスト側が参照するcollection/rkeyと内部マップ保存先は同じ。実PDSへの書込みなし。
- `AdminInteriors` はロード完了前でも「はじまりの村を入れる」を押せる。32×32の下書きを作っても、後から `loadInteriorsRecord` の64×64応答が `setMaps` で上書きする。dirty/選択/「入れた」メッセージは残るため、保存ボタンが有効になり旧64×64を保存して成功表示する。
- 実AdminInteriors + 隔離PDS transportで、strict読込を保留→同梱投入32→読込解放64→保存成功64を再現。ユーザー自身のクリック時刻は取得しておらず、この順番だったとの断定はしない。

## 修正契約
- 読込中/読込失敗中は追加・投入・編集・保存を止め、読込状態を表示する。既存保存データが読み終わってから本人が同梱村の置換確認を行う。
- 保存中は編集/連打も止める。SVGはfieldset無効化だけでは止まらないため描画・ゲートhandlerでも拒否する。
- 保存失敗では下書きとdirtyを保持して再試行できる。保存対象/生成関数/サイズ検証/namespaceは変更しない。
- 既存村の自動縮小・NPC配置やクエスト、ユーザーstateの変更はしない。既存の同梱投入による置換確認は維持。
- 全面authoring整理・migration・権限変更・実PDS投入は対象外。

## 受入
実AppShellとAdminInteriors/AdminQuests、実gzip/保存関数/strict loaderを用い、transportだけ隔離する。390pxで読込遅延中の投入拒否→既存64の読込→確認付き32投入→保存失敗と下書き保持→保存成功→管理経由でクエストへ→3依頼を投入、を検証する。保存したgzipの全タイルを標準32村と比較し、無関係内部マップとNPCレコードを保持、実外部通信なしも確認する。

実iPhone/認証済devの操作は未実施。merge/配備は独立レビュー後に別担当が実行する。

## 検証結果
- 修正前: 同梱投入後の遅延readで32→64へ戻り、実保存関数のputに64が入り成功表示。`expected 32 / received 64` を記録。別のguard回帰も読込中ボタンenabledで失敗した。
- 修正後: 390px実AppShell/両管理画面のブラウザ回帰成功。遅延read、保存503と下書き保持、保存中のサイズ入力/SVGゲート操作拒否、成功payloadのgzip全タイル一致、無関係部屋とNPC保持、クエスト3依頼投入、最後に読込503で全操作不可を確認。
- web typecheck、49 suites/431 tests、lint (既存24warnings・0errors)、build、git diff --check成功。webソースのみのためcore/edgeの再テストや配備は不要。
- 読取証跡・初回失敗ログ・成功ログ・390px画面・diffはrepo外 `pi-work/assets/aozora-village-save-671/` に保存。Google等の外部認証は使用せず、PDS読取も公開getRecordのみ。既知KBはskill参照済み、専用lookup tool/既存認証入口がなく未照会。
