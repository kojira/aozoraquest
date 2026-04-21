# データ整合性レポート

生成: 2026-04-20T19:19:32.781Z

## jobs.json

- ジョブ数: 16 (期待 16)
- ステータス合計=100: **全 16 ジョブ OK** ✓
- statOrder: [atk, def, agi, int, luk] (期待 5 軸)
- 認知機能係数 行和=1.0: **全 8 機能 OK** ✓
- Dominant function 分布: {"Ni":2,"Ti":2,"Te":2,"Ne":2,"Fi":2,"Fe":2,"Si":2,"Se":2}
- Auxiliary function 分布: {"Te":2,"Ne":2,"Ni":2,"Ti":2,"Fe":2,"Fi":2,"Se":2,"Si":2}

## action-weights.json

- アクション数: 14
- 日次上限: 5
- 減衰半減期: 60 日
- 床値: 5
- Opposing pairs: [["atk","def"],["agi","int"]]
- Pair (atk, def): atk+:3, atk-:2, def+:4, def-:3
- Pair (agi, int): agi+:3, agi-:2, int+:6, int-:1

## tags.json

- タグ数: 9 (期待 9)
- プロトタイプ総数: 90 (期待 90)
- モデル宣言: Xenova/multilingual-e5-small
- 次元: 384
- 分類方式: top-1 cosine similarity, threshold 0.7

## packages/prompts/cognitive/*.json

- Ni.json: 25 件
- Ne.json: 25 件
- Si.json: 25 件
- Se.json: 25 件
- Ti.json: 25 件
- Te.json: 25 件
- Fi.json: 25 件
- Fe.json: 25 件
- 合計: 200 件 (期待 200)

## サマリー

- エラー: 0
- 警告: 1

### 警告
- tags.json: metadata.embeddingModel が採用モデルと一致しない (ここは参考情報で、実コードは packages/core/src/embedding-config.ts)
