# 標準NPC8種のその場歩き修正

Issue: https://github.com/kojira/aozoraquest/issues/669（関連 #667 / merged PR #668）
基点: `origin/dev` `0e23eed`。専用worktree `aozoraquest-npc-walk` / `fix/npc-in-place-walk`。
状態: 実装前設計。ユーザー指定の不具合修正範囲内。

## 体験・範囲
`/admin/npcs` の標準8種カード、配置地図、ゲームのNPCで、顔と頭が静止したまま腕と脚が交互に動き、その場歩きをする。目の点滅・色変化・瞬きはなくす。ゲーム内の座標は不変。操作や保存手順は変更しない。

対象は男の子/女の子/若い男性/若い女性/中年男性/中年女性/おじいちゃん/おばあちゃん全部。手描き絵とfallback人形は変更なし。配置UI/保存/PDS/移動処理/権限/ネットワークAPI/失敗・再試行は非対象（今回の変更から呼ばれない）。

## 現行との照合と実装
- `packages/core/src/npc-sprite-presets.ts` は目のEを別色aへ置換してframe1を生成している。これを廃止し、共通の上9行（顔/髪/首を含む）と、個別に描いた下7行×2姿勢で16×16の2frameを組み立てる。
- 下半身は左右どちらかの靴を1px前へ踏み出し、反対の脚は持ち上げる。袖/手も反対側の脚と組で前後を入れ替える。衣装の中央/髪/杖は原則固定し、単なる全身ミラーやCSS上下移動では代替しない。
- 既存paletteと8つのpreset ID、TileArtRecord形式を保持。顔のpalette indexも画素位置も固定。マイグレーション不要。
- `npc-sprite.css` は現行1.2秒（通常75%/瞬き25%）から0.6秒（各姿勢0.3秒）へ変更。visibilityの2frame切替だけを使い、transform/translateは追加しない。reduced-motionでは従来どおりframe0固定。共有NpcSpriteのJS/表示優先順位は変更不要。
- 保存schema/GameState/API/位置に変更がないため復旧はコードrevertのみ。実データ書込・merge・deploy・main変更はしない。

## 検証と受入
- 既存preset unit testの「足固定」を新仕様へ修正。8種全部の16×16/2frame/有効palette、上9行の完全一致、左右の腕領域と左右の脚領域の差分を検査。既存ID/保存往復のテストは継続。
- web必須gate: typecheck / build / 全unit test。関連core test/typecheck。既存ブラウザfixtureの実AdminNpcsと実Worldを隔離通信で使用し、通常実時間で交互切替・座標固定・reduced-motion停止を確認。実PDSへは接続しない。
- 8種のframe対比PNGと実時間GIF、実ゲーム表示GIFをrepo外に保存して目視確認。目固定、手足の交互運動、全身上下動ではないことを示す。実機Safariの確認とは区別する。
- source/read可能diff/全8種画像と検証結果を親へ提供し、独立レビューを受ける。feature commit/pushとPR（base dev）まで。

## 実装・検証結果
- 上9行とpaletteを8種とも固定。下7行に左右の袖/手と前後の靴の2姿勢を描き、300msずつ交互に表示。NPC rendererのJS、座標、schema、保存、個別絵のコードは非変更。
- core 41 suites / 825 tests、core/web typecheck、web 49 suites / 431 tests、web build成功。coreのfocused指定に `--` を挟んだためrunnerが全件を実行した（再実行なし）。buildはローカル検証URLとNSIDを明示。buildの既存大chunk警告、lintの既存24 warnings/0 errorsあり。
- 既存AdminNpcs E2Eに全8カードの実時間1350ms観測を追加。各時点で片方だけ可視、transformなし、各姿勢240–360msで交替を確認。既存の保存/手描き復帰/配置/モバイル390px/ゲーム/reduced-motion検証を含め1 test pass（9.8秒）。
- repo外のローカルQAで実World routeにschemaどおりの隔離NPC8件を表示。通常のrequestAnimationFrameで4.2秒観測し、全8種とも14回交替、観測間隔291.5–308.4ms。全時点でNPC位置transformと保存一覧不変、常に片方のframeだけ可視。全8種reduced-motion停止、PDS putなし、外部通信遮断、pageerrorなし。
- ローカルQAの初回はdesktopで会話backdropの中心clickが会話paneに遮られて失敗。既存の利用者用Enter操作で会話を進めて再検証成功（6.3秒）。プロダクトの会話コードやfixtureは変更していない。
- 8種frame対比PNGを目視: 顔・髪・目は完全固定、左右の手の高低と踏み出す靴が反転。実ゲームPNGと実時間録画からの3秒GIF/拡大GIFを確認。全身が浮くだけの動きではない。
- 証跡: `/Users/kojira/develop/artifacts/npc-walk-669/` の `eight-frame-comparison.png`, `eight-presets-walk.gif`, `game-eight-npcs.png`, `game-walk-realtime.gif`, `game-walk-closeup.gif`, `realtime-game-samples.json` とログ/ローカルQA source。GIF速度は実時間（20fps切出し）、データ絵のGIFは各frame300ms。
- 未実施: 実機Safari/実iPhone、実認証PDS、全Playwright suite、独立レビュー（親担当）、merge/deploy。実データ・main/dev branchへの書込なし。
