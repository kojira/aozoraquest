# 導入会話とマップ内レイアウト (#705)

ユーザー承認: 心配→目覚めへの安心→名乗る→村へ案内。手渡しまで自然につなぎ、操作説明と通知は発話から分離する。
正本: この文書。base: origin/dev f7b86da。既存dirty worktreeは変更しない。

## 体験と実装
- `World.ONBOARDING_LINES`: 地の文2行→心配→安心→名乗る→村のむらおさへ案内。
- 続く手渡し: 無理をしないよう気遣う→やくそう/そらのはねの説明→村で待つ。
- 発話が終わった後、話者/立ち絵なしの受領通知と、実付与マークがある場合のみ20パワー通知。
- 最後に話者/立ち絵なしの「操作ガイド」2行 (移動/村に入る、コマンド/話す)。既存の自分タップのコーチマークも手渡し中は隠す。
- 手渡し済みで導入だけを読む場合も、導入後にガイドを出す。既存の読了/手渡しフラグを使い、新しい永続状態は作らない。
- `DialogueWindow(anchor=map)`: portraitの有無でanchorを解除しない。マップ内余白の上下を上限とする縦flexで、台詞/名前を確保し残りに立ち絵をcontain表示。帽子/顔をcropしない。
- 長文は台詞pane内でscroll可能、既存の全面送り面/キーボード/選択肢の振る舞いは維持。viewport会話は既存表示を維持。

## 不変・非対象
アイテム/20パワー付与条件と保存、API/権限/データ構造/移行、祝福演出の条件、ブルスコンタブ、物語/クエスト、表情切替、edgeは変更しない。実PDS操作なし。main/prod操作なし。mergeは親レビュー承認までしない。

## 完了チェック
| 条項 / production seam | RED | GREEN / 保持証拠 | レビュー |
| --- | --- | --- | --- |
| map内の立ち絵/名前/台詞 / DialogueWindow,NpcPortrait | 320pxでmap下端314に対しportrait下端444.80、bbox assertion失敗 | 390/320px mobileと1280px PCのbbox JSON・実心配顔screenshots通過 | 待ち |
| 会話順とシステム分離 / World | 旧文言・話者のassertionを更新 | 導入→手渡し→通知→ガイドのE2E、手渡し済みの再導入 | 待ち |
| 通常NPC/選択肢/画像失敗 / 共通会話 | 既存テストを保持 | opening-storyの通常NPC・画像失敗・受注とdialogue unit | 待ち |

## 検証境界
隔離E2Eはproduction World/DialogueWindowとfixture transportを使う。実心配顔は環境変数でrepo外から渡す。単色fixtureはCI機能回帰用のみで視覚合格の証拠にしない。
実認証ゲーム/実機Safariは本段階では未確認。実画像E2E (opening-story/tutorial/npc-image-upload/world-town-arrival) 6件、dialogue関連unit 13件、typecheck/lint/build通過。CIと独立レビューはPRで確認する。

## 証拠と再開地点
- repo外証拠: `/Users/kojira/develop/pi-work/assets/aozora-opening-dialogue-map/`
- `opening`, `village-invitation`, `handoff`, `feather`, `guide`, `normal-npc`, `quest-choices` の各 `-{320,390,1280}.png/.json`。
- 実心配顔 `02CC0FA3-D3BF-4B3E-8EF8-056821C47A2C-512x768.webp` を `OPENING_PORTRAIT` に渡す。画像自体をrepoへ追加しない。
- 台詞面を押して導入→手渡し→通知→ガイドを通過、画像404でもガイドまで完了、通常NPC/受注選択肢も通過。
- 実認証/PDS実書込みなし。buildはloopback/test設定。元worktreeの未追跡test-resultsは維持。
- 次: base devのPRで必須CI結果を保持し、親へhead/全文会話/スクショを提示。mergeは承認まで保留。
