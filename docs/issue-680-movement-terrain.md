# Issue 680: ドット単位の滑らかなスクロール

## 最新承認 / 目的
当初の模様差・足跡案は**撤回**。ユーザー追加指示『ドラクエみたいにドット単位でのスムーズスクロール』『連続移動の時にもスムーズ』が正本。親は描画位置と論理位置の分離、初回16ms描画バッファと連続170ms歩行の実測を承認。地形やartを追加/改変しない。旧設計と初期WIPはrepo外assets/wipへ保管。

## 再現 / 原因
現Worldは16x16、プレイヤー中央固定。移動時setWsで新タイルを1マス即時置換。同梱地形は同一defsで反復するため、均一平地で実World+handleMove成功後も前後PNGが完全一致することを再現した。既存楽観移動とサーバー権威・署名tokenの位置契約は変更しない。

## 実装前に合意した表示設計（新方針のsource編集前に親と確認）
- Worldが既存通行guardを通した移動だけ `{dx,dy,target x/y/mapId}` を描画へ渡す。論理位置は従来通り即更新、同一mapの新座標から見たoffsetを(dx*32,dy*32)→0へ消費し地形+NPCを一緒に動かす。avatar/影/HUD/タップ領域は固定。
- useLayoutEffectで新タイルとoffsetをpaint前に同期、requestAnimationFrameでSVG層transformのみ変更する。丸めたSVG pixelで描く。各フレームでReactタイル再描画しない。
- スティックは即1歩+170ms反復、転向は最短85ms＋timer再設定。キーボードは既存OS keydown repeat。標準描画速度32px/170ms。最初だけ16msバッファを置いてフレームと入力timer位相の隙間を吸収、各歩で待ちを追加しない。
- 既に描画中なら残りの直交step列へ追加。現在位置を引継ぎ、方向転換で斜めに角を切らない。前stepから200ms以内を連続とし、120ms未満の速いrepeat/転向のみ受理間隔（下限16ms）から速度を求める。通常120..200msはtimerの微小ジッタで速度を上下させず170ms固定。長い間隔後は170msへ戻す。通信や論理移動頻度は不変。
- 指を離しても受理済み最後のtargetまで描いて正確に0へ整列。未入力/未受理の先のマスを描画目標にしない。遅いサーバーでは既存busy guardで次歩が抑止されるため停止し得る。これを通信成功の保証と混同しない。
- 同一成功応答は再始動しない。拒否/同位置/補正/別map/ワープはoffset破棄して0。既存rollback/扉演出を維持。map切替に旧NPCや地形offsetを残さない。
- 外周は残offsetのL1距離を覆う分だけ追加しviewportでclip。普通の歩行は1〜2タイル程度。速いrepeatでも空白を作らない。NPCも同じ座標系/外周を使う。wrapは方向deltaを使い1023→0で巨大スクロールを作らない。
- reduced-motionは即時切替（スクロールなし）。設定変更中とunmountでrAFをcancel。停止後timer無し。

## 不変 / 境界
地形種、生成、通行、NPC配置、岸辺接続と下地アート、保存形式、位置API、報酬、実PDS/ユーザーデータに変更なし。editorは静止した絵が変わらないため変更不要。新schema/移行/権限/復旧APIなし。完全単色の自作絵はスクロールしても視覚的差が無い限界を隠さない。今回は絵や足跡で補わない。

## 受入
実World+handleMoveで草地/林/森/水の移動途中が変化し終点は同じ絵、往復/reloadで一致。主要証跡は通常170ms長押し→転向→離すの動画と各rAF座標で停止/跳ね/蓄積遅延なしを確認。単発、キーボード連続、衝突、拒否、同座標、遅延、gate/wrap、reduced-motion、最後の整列も回帰。既存岸辺E2Eと必須typecheck/build/web test/lint。Chromium隔離transportは実Safari・認証済み実データ検証とは区別。独立review/CI/配備は後続担当。

## 実測・仕上げ
- 連続フレーム観測で、add時とrAF callback時刻の逆転による時間巻戻りを修正。入力ごとにrAFをcancel/再登録せず同じloopで進め、各歩でバッファが再開しないよう連続判定を修正。
- 170ms実VirtualStick長押し→転向→離す: 257フレーム、直線中68サンプル、後戻りなし・2refresh連続停止なし。最大残offset37px、停止時0。3箇所は1refresh同一pixel（丸め/観測位相）であり全フレーム変化と誤報しない。純モデル5秒連続は毎tick一定速度を検証。
- 実World+handleMove: 平地/林/森/水/単色自作の単発と往復/reload、同位置補正/拒否/衝突、遅い応答busy、gate別map、wrap往復、reduced-motion。既存岸辺editor保存→Worldの回帰は変更なしで成功。
- 旧baseline fixtureは通常移動の位置が署名tokenであるのにPDS x更新を待って失敗したため、test transportで実handleMove戻り値をfixture再load checkpointへ反映。アプリの位置保存処理は変更していない。元の静止PNG一致はこの修正後に再現。
- 初回buildの環境変数不足、テスト作成時の構文/fixture壁位置、過度に厳しい毎refresh非重複assertの失敗もassetsログへ保持。
