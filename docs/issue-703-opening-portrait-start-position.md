# #703 導入の会話イラストが出ない + 開始位置 + 手渡しの話者

## 範囲
web の管理データ読込・導入/手渡しの台詞、edge の新規開始位置。範囲外: main/本番配備、実ユーザーの保存データの書換え、保存schema変更。

## 1. 会話イラストが出ない
- 原因: `Agent` の `getRecord` は応答を `jsonToLex` で復元し、blob を `BlobRef` インスタンス (ref は CID オブジェクト) にする。
  `assertNpcImage` は保存形 JSON (`{$type:'blob', ref:{$link}}`) 前提なので、NPC レコード全体が不正扱いで `setNpcs` されず、
  Blueskyちゃんの `portraitImage` が無い状態になっていた。
- 修正: `world-authoring.ts` の `adminRecordJson` で読んだ管理レコードを JSON 往復して保存形に戻す
  (`lexToJson` は @atproto/lexicon が 2 版入っていて instanceof が外れるため使わない)。
- テスト: `world-authoring.test.ts` (BlobRef を含む実応答形で portraitImage が残る)、E2E fixture も `jsonToLex` を通す。

## 2. 開始位置
- 新規・リセット後 (`migrateInitState` で旧 world-record が無いとき) は はじまりの街の**一つ下** (村から出たときの着地点と同じ)。
  歩けなければ街そのもの (`initialPosition()`)。
- **既存プレイヤーの位置は変えない**: 権威 gameState がある人は `migrateInitState` を通らず、旧 world-record の座標がある人もそれを引き継ぐ。
- テスト: `battle-resolver.test.ts`。

## 3. 手渡しの話者
導入に続く やくそう/そらのはね の手渡し・祝福を ブルスコン → Blueskyちゃん (導入と同じ会話イラスト) に。最後は「いこう！」。
E2E `opening-story.spec.ts` で話者・イラスト・祝福演出まで確認。
