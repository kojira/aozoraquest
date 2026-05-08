# TinySwallow 指示追従性: system vs user role 比較

実行日: 2026-05-08
モデル: `onnx-community/TinySwallow-1.5B-Instruct-ONNX` (q4, CPU)
パラメータ: temperature=0 (greedy), max_new_tokens=100, repetition_penalty=1.1
テスト: 50 件 × 2 条件 = 100 generation
ランナ: `scripts/bench-tinyswallow-instruction-following.mjs`
詳細データ: `tinyswallow-instruction-following-result.json`

## 定量結果

| 条件 | PASS | 率 |
|-|-|-|
| **system role に指示** | 11/50 | **22.0%** |
| **user role に指示** | 27/50 | **54.0%** |
| 差 | -16 | **user が +32 ppt 勝ち** |

「TinySwallow は system role の指示をあまり守らない」というユーザの観察が
定量的に裏付けられた。

## カテゴリ別の傾向

### user 圧勝 (sys ほぼ無視されるパターン)
- **「X で始めてください」** (5 件): sys 0/5, user 5/5
  - sys 側は「はい！」「私は Google の AI...」のようなデフォルト挨拶/自己紹介を返す
- **「特定の語を含めて」** (青空 / 風 / 猫): sys 0/3, user 3/3
  - sys は「申し訳ありませんが、リアルタイム情報に...」のテンプレ謝罪
- **末尾指定** (！で終え、ね。で終え 等): user 5/5, sys 1/5
- **箇条書き / 番号リスト**: user のみ obey

### sys が勝った珍しいケース (3 件のみ)
- 「？で終え」「私を使わずに」「漢字 1 個も使わずに」
- 共通点: **シンプルな negative constraint** (排除のみ、追加・配置の指定なし)

### 両方 PASS (簡易 / 自然な制約 8 件)
改行使わない / 数字使わない / 絵文字使わない / 敬語 / 漢字 3 個以上 /
100 字以内 / 1 文だけ など — ベースのアシスタントが自然に守る範囲

### 両方 FAIL (モデル本質的弱点 ~20 件)
- 絶対カウント: 「5 字ちょうど」「3 文ちょうど」「4 行で」「! 3 個ちょうど」
- スクリプト排他: 「全てひらがな」「全てカタカナ」
- 任意トークン挿入: 「数字 7 を含めて」「ありがとうを含めて」
- 「英字を使わずに」→ 両方とも英語に flipped (`I don't have personal preferences...`)
  指示の意図 (no English) と直交した方向に走る

## 観察された system role 特有の癖

1. **デフォルトのアシスタント人格が強い**: 「私は Google の AI です」「Sakana AI の
   TinySwallow です」「申し訳ありませんが、リアルタイム情報には...」のテンプレ
   応答が頻発。system に指示を書いても上書きされにくい
2. **system は指示というより「設定」として軽く参照される印象**
3. user に instruction を書くと、モデルは「指示を含む単一のリクエスト」として
   解釈し、はるかに素直に従う

## spirit.tsx への適用案

現状: prompt は system role に固定で渡している。

- 操作的指示 (長さ / 開始終了 / 形式 / 含める語) は **user 側に prepend**
  する方が遥かに従順
- system は **人格設定だけ** にとどめる
- **negative constraint** (「X を使わない」) は system でも効く例外なので使い分け可
- admin の prompt body も「system に書く部分」と「user に prepend する部分」を
  分けて編集できる UI にする手がある (`bodySystem` / `bodyUserPrefix` 的な分割)

## 補足

- temperature=0 (greedy) で測定。実運用 (temp > 0) でランダム性が入っても、
  指示に対する relative 比較は同じ傾向のはず
- max_new_tokens=100 が短いせいで「N 文で答える」系のテストが切れる影響あり
  → ただし system / user 両方に同条件なので比較には影響しない
- モデル本質的弱点 (絶対カウント / スクリプト排他) は role を変えても解決
  しない。これは別の対策 (出力後 re-validate / 別モデル) が必要
