# docs/data/validation/

11-validation.md §実験 1 (Browser LLM 選定) のテストデータを置くディレクトリ。

## ファイル一覧

| ファイル | 内容 | 件数目安 |
|---|---|---|
| `cognitive_labeled.jsonl` | 認知機能ラベル付き日本語投稿 | 40 件 (8 機能 × 5 件) |
| `tag_labeled.jsonl` | タグラベル付き日本語投稿 | 90 件 (9 タグ × 10 件) |
| `neutral.jsonl` | 中立 (ラベル困難) な日常投稿 | 120 件 |

**重要**: プロトタイプ (`packages/prompts/cognitive/*.json` と `docs/data/tags.json`) に含まれる投稿と同一文字列を含めない。リーケージ検出のため、作成時にチェックする。

## フォーマット

### cognitive_labeled.jsonl

1 行 1 JSON オブジェクト。

```jsonl
{"text": "この動きは、遠くない未来に大きな流れを作るだろう。", "label": "Ni"}
{"text": "新しいアイデアを思いついた！これを元にあれもこれも展開できそう", "label": "Ne"}
```

`label` は以下のいずれか:
- `Ni` (内向的直観)
- `Ne` (外向的直観)
- `Si` (内向的感覚)
- `Se` (外向的感覚)
- `Ti` (内向的思考)
- `Te` (外向的思考)
- `Fi` (内向的感情)
- `Fe` (外向的感情)

各機能について 5 件。「この投稿はその機能が前面に出ている」と 2 人以上のレビュワーが合意したもののみ採用する。

### tag_labeled.jsonl

```jsonl
{"text": "みんなおすすめのノート PC ある？", "label": "question"}
{"text": "仕事でミスして明日会社行くのがこわい", "label": "distress"}
```

`label` は以下のいずれか: `question`, `distress`, `goodnews`, `humor`, `analysis`, `opinion`, `underseen`, `fresh`, `debated`。

### neutral.jsonl

```jsonl
{"text": "今日はいい天気だね"}
{"text": "コンビニでお茶を買ってきた"}
```

ラベルなし。特定のカテゴリに強く属さない「普通の」投稿を集める。
目的: プロトタイプ分類での **false positive 率** を測る (高閾値 0.7 を超えないかチェック)。

## 作成手順

1. **Claude などで原案を生成**: 11-validation.md §実験 1 の指示を元に
2. **手動レビュー**: 各機能 / タグの純度を人が確認
3. **プロトタイプとの重複チェック**: 単純文字列一致と、類似度 > 0.95 で 2 段階チェック
4. **バランス確認**: 口調 / トピック / 長さが偏っていないか
5. **リポジトリにコミット**: テストケースがレビュー通過したら `*.jsonl` として保存

## 実行

データが揃ったら:

```bash
pnpm tsx scripts/validate-llm.ts
```

詳細は `scripts/README.md` を参照。

## プライバシー

投稿はすべて**作成物 (または公開済み Bluesky 投稿の引用許諾済みもの)**。実在の Bluesky ユーザーの未許諾投稿を使わない。
