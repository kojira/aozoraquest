# ブラウザ内 LLM 生成モデル ベンチマーク (Playwright + WebGPU)

- 生成: 2026-04-20T18:32:14.827Z
- 環境: Playwright Chromium (WebGPU)
- ハーネス: `scripts/validate-llm-gen-harness.html`
- プロンプト 3 件 (春の空 / 朝の挨拶 / クエスト達成)

## サマリー

| モデル | dtype | ロード | 生成 1件平均 | tok/s 平均 | 備考 |
|---|---|---|---|---|---|
| `onnx-community/TinySwallow-1.5B-Instruct-ONNX` | q4f16 | 2.7s | 0.5s | 117.7 tok/s |  |
| `onnx-community/TinySwallow-1.5B-Instruct-ONNX` | int8 | 49.8s | 26.0s | 5.7 tok/s |  |
| `onnx-community/TinySwallow-1.5B-Instruct-ONNX` | q4 | 58.3s | 0.4s | 119.1 tok/s |  |

## onnx-community/TinySwallow-1.5B-Instruct-ONNX (q4f16)

- status: **ok** (done)
- WebGPU: ✓ {}
- ロード: 2.7s

### 生成結果

#### 春の空
- レイテンシ: 0.6s / 9 字 / 24.0 tok/s

```
「希望に満ちた青」
```

#### 朝の挨拶
- レイテンシ: 0.1s / 6 字 / 63.3 tok/s

```
「おはよう」
```

#### クエスト達成
- レイテンシ: 0.9s / 104 字 / 176.1 tok/s

```
## 詩的祝福

**三首の一筆:**

* **祝福:** 短いながらも力強く届けます。
* **祝福:** 明るく羽ばたくような喜びを込めて。
* **祝福:** 清らかい風と共に、心から伝えてください。
```

#### LV アップ
- レイテンシ: 0.4s / 37 字 / 146.9 tok/s

```
**心からの祝いと感謝！**
（簡素な表現でも相手への敬意が伝わるように）
```

#### 節制クエスト案内
- レイテンシ: 0.5s / 61 字 / 177.9 tok/s

```
"今日はゆっくりと文章を読み解く日となりました。集中力を保ち、質の高い分析をお楽しみください。「青空のもと、静寂の中で」"
```

<details><summary>ハーネスログ</summary>

```
18:28:07.894 harness start. model=onnx-community/TinySwallow-1.5B-Instruct-ONNX dtype=q4f16 device=webgpu
18:28:07.901 webgpu: {"supported":true,"info":{}}
18:28:07.935   DL start: config.json
18:28:07.935   DL start: tokenizer.json
18:28:07.935   DL start: tokenizer_config.json
18:28:07.936   DL done:  config.json 0MB in 0.0s
18:28:07.936   DL start: onnx/model_q4f16.onnx
18:28:07.937   DL start: onnx/model_q4f16.onnx_data
18:28:07.937   DL start: generation_config.json
18:28:07.937   DL done:  tokenizer_config.json 0MB in 0.0s
18:28:07.941   DL done:  onnx/model_q4f16.onnx 0MB in 0.0s
18:28:07.943   DL done:  generation_config.json 0MB in 0.0s
18:28:07.943   DL done:  tokenizer.json 0MB in 0.0s
18:28:08.478   DL done:  onnx/model_q4f16.onnx_data 0MB in 0.5s
18:28:10.646 load OK (total 2.7s: DL + ONNX session 2.2s)
18:28:11.230 [春の空] 0.6s (24.0 tok/s, 9 chars)
18:28:11.372 [朝の挨拶] 0.1s (63.3 tok/s, 6 chars)
18:28:12.259 [クエスト達成] 0.9s (176.1 tok/s, 104 chars)
18:28:12.640 [LV アップ] 0.4s (146.9 tok/s, 37 chars)
18:28:13.157 [節制クエスト案内] 0.5s (177.9 tok/s, 61 chars)
18:28:13.158 done
```

</details>

## onnx-community/TinySwallow-1.5B-Instruct-ONNX (int8)

- status: **ok** (done)
- WebGPU: ✓ {}
- ロード: 49.8s

### 生成結果

#### 春の空
- レイテンシ: 31.7s / 162 字 / 7.7 tok/s

```
このシステムにはエラーがあります

このシステムでは何が起こっていますか？

具体的に教えてください

エラーメッセージや出力結果が必要です。

私は、英語での説明を求めています。
ご返信ありがとうございます。しかし、提供された情報からは、問題の原因を推測することはできません。 より具体的なフィードバックと詳細情報を求めて
```

#### 朝の挨拶
- レイテンシ: 31.1s / 126 字 / 6.1 tok/s

```
「挨拶」に関連する文脈としては何が挙げられますか?

A: メンバーシップの申し込みについて

B: 物件の見学予約について

C: 初めて訪問した土地に関する感想

D: 新しいビジネスパートナーとの出会いと関係構築

A,B,C,D の中から一つ選
```

#### クエスト達成
- レイテンシ: 4.3s / 0 字 / 0.2 tok/s

```

```

#### LV アップ
- レイテンシ: 31.1s / 170 字 / 8.2 tok/s

```
「しかし」という形容詞的な用法において、「however」は文脈によって異なる意味合いを持つ可能性があります。

**1. 違いを理解する:**

* **however:** 主な主張がある後で使用される副次的または否定的なアイデアを示すために通常使われます。
    * 正しい例:** However, she was able to
```

#### 節制クエスト案内
- レイテンシ: 31.9s / 139 字 / 6.6 tok/s

```
あなたが作成した質問に応えてください。

**注意**: ここで言う「クエスト」とは、目標達成の過程やそれを求める情熱、あるいはそのために行動すること自体を意味するかもしれません。「システム」もまたこの解釈では、何らかの課題（または現実）に対する解決策となる可能性のあるアイデア
```

<details><summary>ハーネスログ</summary>

```
18:28:13.811 harness start. model=onnx-community/TinySwallow-1.5B-Instruct-ONNX dtype=int8 device=webgpu
18:28:13.830 webgpu: {"supported":true,"info":{}}
18:28:14.264   DL start: config.json
18:28:14.264   DL start: tokenizer.json
18:28:14.264   DL start: tokenizer_config.json
18:28:14.267   DL done:  config.json 0MB in 0.0s
18:28:14.267   DL start: onnx/model_int8.onnx
18:28:14.268   DL start: generation_config.json
18:28:14.271   DL done:  tokenizer_config.json 0MB in 0.0s
18:28:14.271   DL done:  tokenizer.json 0MB in 0.0s
18:28:14.414   DL done:  generation_config.json 0MB in 0.1s
18:29:01.892   DL done:  onnx/model_int8.onnx 0MB in 47.6s
18:29:03.648 load OK (total 49.8s: DL + ONNX session 1.8s)
18:29:35.332 [春の空] 31.7s (7.7 tok/s, 162 chars)
18:30:06.433 [朝の挨拶] 31.1s (6.1 tok/s, 126 chars)
18:30:10.777 [クエスト達成] 4.3s (0.2 tok/s, 0 chars)
18:30:41.920 [LV アップ] 31.1s (8.2 tok/s, 170 chars)
18:31:13.805 [節制クエスト案内] 31.9s (6.6 tok/s, 139 chars)
18:31:13.806 done
```

</details>

## onnx-community/TinySwallow-1.5B-Instruct-ONNX (q4)

- status: **ok** (done)
- WebGPU: ✓ {}
- ロード: 58.3s

### 生成結果

#### 春の空
- レイテンシ: 0.4s / 17 字 / 62.6 tok/s

```
"新しい一年の始まりが見られる空"
```

#### 朝の挨拶
- レイテンシ: 0.3s / 26 字 / 125.8 tok/s

```
おはよう！ ☀️  
今日も元気に過ごしましょうね。
```

#### クエスト達成
- レイテンシ: 0.5s / 39 字 / 129.8 tok/s

```
「短くても美しく、心温まる言葉が生まれましたね。」という祝福をお伝えします。✨
```

#### LV アップ
- レイテンシ: 0.5s / 50 字 / 163.8 tok/s

```
おめでとうございます！大きなステップですね。
この新しいレベルでの冒険と成長を心から応援しています。
```

#### 節制クエスト案内
- レイテンシ: 0.4s / 28 字 / 113.7 tok/s

```
「今日は長文分析の代わりに短い対話を試してみませんか？」
```

<details><summary>ハーネスログ</summary>

```
18:31:14.479 harness start. model=onnx-community/TinySwallow-1.5B-Instruct-ONNX dtype=q4 device=webgpu
18:31:14.485 webgpu: {"supported":true,"info":{}}
18:31:14.765   DL start: config.json
18:31:14.766   DL start: tokenizer.json
18:31:14.766   DL start: tokenizer_config.json
18:31:14.767   DL done:  config.json 0MB in 0.0s
18:31:14.768   DL start: onnx/model_q4.onnx
18:31:14.768   DL start: onnx/model_q4.onnx_data
18:31:14.768   DL start: generation_config.json
18:31:14.771   DL done:  tokenizer_config.json 0MB in 0.0s
18:31:14.771   DL done:  tokenizer.json 0MB in 0.0s
18:31:14.915   DL done:  generation_config.json 0MB in 0.1s
18:31:14.917   DL done:  onnx/model_q4.onnx 0MB in 0.1s
18:32:09.832   DL done:  onnx/model_q4.onnx_data 0MB in 55.1s
18:32:12.753 load OK (total 58.3s: DL + ONNX session 2.9s)
18:32:13.169 [春の空] 0.4s (62.6 tok/s, 17 chars)
18:32:13.479 [朝の挨拶] 0.3s (125.8 tok/s, 26 chars)
18:32:13.934 [クエスト達成] 0.5s (129.8 tok/s, 39 chars)
18:32:14.392 [LV アップ] 0.5s (163.8 tok/s, 50 chars)
18:32:14.762 [節制クエスト案内] 0.4s (113.7 tok/s, 28 chars)
18:32:14.762 done
```

</details>
