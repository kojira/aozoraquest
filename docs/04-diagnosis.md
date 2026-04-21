# 04 - 気質診断

## 概要

ユーザーの直近の投稿からユング派の 8 認知機能それぞれの発現度を推定し、そこから 16 の気質 (ジョブ) を導出する。全処理はブラウザ内で完結し、Claude API を使わない。

## 認知機能とは

ユング派心理学で定義される 8 つの心の働き。それぞれ独立した「チャンネル」のように作用する。

| 略記 | 名称 | 簡単な説明 |
|---|---|---|
| Ni | 内向的直観 | 表面の奥にある本質・パターン・ビジョンを直感的に掴む |
| Ne | 外向的直観 | 連想・可能性の列挙、アイデアの発散 |
| Si | 内向的感覚 | 記憶・既知の詳細・一貫性・伝統 |
| Se | 外向的感覚 | 今この瞬間の感覚、身体性、即時の反応 |
| Ti | 内向的思考 | 内的論理体系の構築、定義の精密化 |
| Te | 外向的思考 | 効率・結果・外的な秩序化 |
| Fi | 内向的感情 | 個人的な価値観、真正性、内なる倫理 |
| Fe | 外向的感情 | 場の調和、他者の感情への配慮 |

16 の気質はこれらの機能が異なる順序でスタックされたもの。例えば「賢者」は Ni-Te-Fi-Se のスタック (ドミナント - オグジリアリー - ターシャリー - インフェリア)。

## 診断アルゴリズム

### 方式: 埋め込みプロトタイプ類似度

事前に各認知機能について 25 個の「その機能が強く出る日本語投稿の例」(プロトタイプ) を用意し、開発時に埋め込み済みで配布する。診断時はユーザーの投稿を同じ埋め込みモデルでベクトル化し、プロトタイプとのコサイン類似度で機能スコアを出す。

**使用する埋め込みモデルは `sirasagi62/ruri-v3-30m-ONNX` (int8、日本語ネイティブ、37MB、256次元)** (11-validation.md §実験 1 の結果で確定、`docs/data/llm-benchmark.md`)。認知機能 argmax Top-1 82.5%、Top-3 97.5%、タグ argmax Top-1 73.3%、p95 レイテンシ 1.4ms (WASM) を達成。診断はバッチ集約なので閾値不要で argmax 値を使う。採用理由と合格判定の詳細はベンチマークレポートを参照。

### 入力

- ユーザーの直近 N 件の投稿 (デフォルト 150 件、最小 50 件)
- 本人のオリジナル投稿とリプライのみ (リポスト、引用リポストは除外)
- 10 文字未満の投稿は除外 (ノイズ対策)

### 処理

```typescript
async function diagnose(posts: Post[]): Promise<DiagnosisResult> {
  if (posts.length < 50) {
    return { confidence: 'insufficient', posts: posts.length };
  }
  
  const scores: Record<Function, number[]> = {
    Ni: [], Ne: [], Si: [], Se: [],
    Ti: [], Te: [], Fi: [], Fe: [],
  };
  
  for (const post of posts) {
    const vec = await embed(post.text);
    for (const func of FUNCTIONS) {
      const similarities = PROTOTYPES[func].map(p => cosine(vec, p));
      similarities.sort((a, b) => b - a);
      // Top-3 の平均を採用 (ノイズに強い)
      const top3Avg = similarities.slice(0, 3).reduce((a, b) => a + b) / 3;
      scores[func].push(top3Avg);
    }
  }
  
  // 投稿全体での平均スコア
  const avgScores: Record<Function, number> = {};
  for (const func of FUNCTIONS) {
    avgScores[func] = scores[func].reduce((a, b) => a + b) / scores[func].length;
  }
  
  // 正規化 (最大値を 100 に)
  const max = Math.max(...Object.values(avgScores));
  const normalized: Record<Function, number> = {};
  for (const func of FUNCTIONS) {
    normalized[func] = Math.round(avgScores[func] / max * 100);
  }
  
  // トップ 2 のペアから気質を決定
  const sorted = Object.entries(normalized).sort((a, b) => b[1] - a[1]);
  const [dom, aux] = sorted.slice(0, 2).map(e => e[0]);
  const typeId = lookupTypeByFunctionPair(dom, aux);
  
  // 信頼度判定
  const confidence = computeConfidence(posts.length, normalized);
  
  return {
    typeId,
    cognitiveScores: normalized,
    confidence,
    analyzedPostCount: posts.length,
    analyzedAt: new Date().toISOString(),
  };
}
```

### 気質判定テーブル

ドミナント × オグジリアリーのペアから 16 タイプのどれかを一意に決定する。

| ドミナント | オグジリアリー | ジョブ id |
|---|---|---|
| Ni | Te | `sage` |
| Ni | Fe | `seer` |
| Ne | Ti | `bard` |
| Ne | Fi | `explorer` |
| Si | Te | `warrior` |
| Si | Fe | `guardian` |
| Se | Ti | `ninja` |
| Se | Fi | `performer` |
| Ti | Ne | `mage` |
| Ti | Se | `fighter` |
| Te | Ni | `shogun` |
| Te | Si | `captain` |
| Fi | Ne | `poet` |
| Fi | Se | `artist` |
| Fe | Ni | `paladin` |
| Fe | Si | `miko` |

無効なペア (例: Ni と Se のようなスタック理論的に共存しない組み合わせ) になった場合、3 位まで見て再判定する。3 位までで決まらなければ `confidence: 'ambiguous'` とする。

### 信頼度

```typescript
function computeConfidence(
  postCount: number,
  scores: Record<Function, number>
): Confidence {
  if (postCount < 50) return 'insufficient';
  
  const sorted = Object.values(scores).sort((a, b) => b - a);
  const gap1to2 = sorted[0] - sorted[1];
  const gap2to3 = sorted[1] - sorted[2];
  
  if (gap1to2 < 5 || gap2to3 < 5) return 'ambiguous';
  if (postCount < 100) return 'low';
  if (gap1to2 < 10) return 'medium';
  return 'high';
}
```

信頼度が `low` / `ambiguous` のときは UI に明示する:
- 「傾向型: 賢者 (研究者の可能性も)」
- 「サンプルが少ないので揺らぎます」

## 認知機能から RPG ステータスへ

5 軸ステータスは認知機能スコアから機械的に合成される。

### 合成係数

| 機能 | ATK | DEF | AGI | INT | LUK |
|---|---|---|---|---|---|
| Ni | 0 | 0.1 | 0 | 0.8 | 0.1 |
| Ne | 0 | 0 | 0.5 | 0 | 0.5 |
| Si | 0.1 | 0.8 | 0 | 0.1 | 0 |
| Se | 0.3 | 0 | 0.7 | 0 | 0 |
| Ti | 0 | 0.1 | 0.1 | 0.8 | 0 |
| Te | 0.8 | 0 | 0 | 0.2 | 0 |
| Fi | 0 | 0.5 | 0 | 0 | 0.5 |
| Fe | 0 | 0.3 | 0 | 0 | 0.7 |

### 合成式

```typescript
function cognitiveToRpg(scores: Record<Function, number>): Record<Stat, number> {
  const rpg: Record<Stat, number> = { atk: 0, def: 0, agi: 0, int: 0, luk: 0 };
  for (const [func, score] of Object.entries(scores)) {
    for (const [stat, coef] of Object.entries(COEF[func])) {
      rpg[stat] += score * coef;
    }
  }
  // 正規化して合計 100 にする
  const total = sum(Object.values(rpg));
  return Object.fromEntries(
    Object.entries(rpg).map(([k, v]) => [k, Math.round(v / total * 100)])
  );
}
```

## プロトタイプ投稿集の作成

開発時に Claude で生成し、人間がレビューする。最終的に 8 機能 × 25 投稿 = 200 件を用意する。

### 生成プロンプト (例: Ni)

```
ユング派の認知機能「内向的直観 (Ni)」は、表面的な出来事の奥にある
パターンや本質、未来のビジョンを直感的に把握する働きです。
以下の特徴を持つ人が、日常的に Bluesky に投稿しそうな
自然な日本語の短い投稿を 25 個作ってください。

特徴:
- 物事を統合的に捉える
- 「なぜ分かるのか説明できないが」という感覚
- 将来の帰結を直感的に予測する
- 象徴や比喩を好む
- 具体的な事象から抽象的な本質へと意識が流れる

制約:
- 各投稿は 50-150 文字
- 過度に哲学的・宗教的にしない (Bluesky の日常投稿レベル)
- 多様なトピック (仕事、人間関係、ニュース、日常の観察)
- 主語や人称は自然に混ぜる
- Ni 以外の機能が強く出る文面は避ける
- 「本質」「パターン」のようなキーワードを使いすぎない

出力形式: JSON 配列、各要素は { "text": "..." }
```

### レビュー基準

1. **機能の純度**: その機能が前面に出ているか。他の機能と混じっていないか
2. **自然さ**: 実際の Bluesky ユーザーが書きそうか
3. **多様性**: トピック、口調、長さのバリエーションがあるか
4. **言語的中立**: 特定の職業や年齢層に偏らないか

人間レビュワーが問題ありと判断した投稿は差し替え。最終セットは本アプリのライセンスで配布可能な状態にする (Claude 生成物なので著作権的にクリア)。

### 事前埋め込み

ビルド時にすべてのプロトタイプを埋め込み、`Float32Array` のバイナリとして静的アセットに含める。モデル ID は `packages/core/src/embedding-config.ts` の `EMBEDDING_MODEL_ID` を参照する (実験 1 で確定した値)。

```typescript
// build-time script
import { pipeline } from '@huggingface/transformers';
import { EMBEDDING_MODEL_ID, EMBEDDING_DTYPE } from '@aozoraquest/core/embedding-config';
import prototypes from './prototypes.json';

const extractor = await pipeline('feature-extraction',
  EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });

const output: Record<string, Float32Array[]> = {};
for (const [func, texts] of Object.entries(prototypes)) {
  const vecs = await extractor(texts, { pooling: 'mean', normalize: true });
  output[func] = vecs.tolist();
}

// シリアライズして public/prototypes/<func>.bin に保存
```

ブラウザ側は `fetch` で `.bin` を取得して `Float32Array` にパースする。1 機能あたり 25 × `EMBEDDING_DIMENSIONS` 次元 × 4 バイト (e5-small の 384 次元なら約 38 KB)、8 機能で 8 倍。モデルを差し替えた場合はプロトタイプも同じモデルで再生成する (次元不整合を防ぐため、アセット名にモデル ID ハッシュを入れる)。

## 再解析のタイミング

診断は日に何度も動かすコストの高い処理なので、タイミングを絞る。

**自動再解析**:
- 前回解析から 24 時間以上経過 かつ
- 新規投稿が 10 件以上溜まった時
- アプリ起動時にチェック、条件満たせばバックグラウンドで実行

**手動再解析**:
- 設定画面の「再解析」ボタン
- 最小間隔 1 時間 (連打防止)
- 解析中は精霊が「賢者の算段をしておる...」と演出

## プライバシー

- 投稿内容は LLM に渡すが、すべてブラウザ内処理。第三者サーバーに送信されない
- 診断結果を PDS に保存する際、`public` フラグで公開/非公開を選択可能
- 非公開時は PDS のアクセスコントロールで自分の DID 以外からのアクセスを制限
- 公開時は他ユーザーが相性判定に利用可能

## エッジケース

### 投稿数不足

50 件未満の場合は診断を拒否。「まだ歩みが浅い。もう少し投稿してから改めて来てくれ」と精霊が伝える。

### 多言語ユーザー

プロトタイプは日本語で作る。ユーザーの投稿が英語メインなら精度が落ちる。初期 MVP は日本語ユーザーを対象とする。将来的に英語プロトタイプを別途用意する。

### 診断結果への違和感

「これは違う」と感じるユーザーには、認知機能スコア内訳と直近の根拠投稿を見せるオプションを提供する。フィードバックボタンを用意し、ユーザーの自認タイプを記録 (将来プロトタイプ改善に使う)。

## 外部 LLM による上位診断 (BYOK)

LLM API キー (Anthropic または OpenRouter、09-tech-stack.md §外部 LLM 呼び出し) を設定したユーザー向けに、高品質モデル (Claude Sonnet 相当) による詳細診断をオプションで提供する。呼び出しはユーザーのキーでブラウザから直接行う。

- より深い説明文の生成
- 投稿の具体的引用とその解釈
- 成長ヒントのパーソナライズ

ただしこれは**補助的機能**。メインの診断はあくまでローカルで完結する設計を崩さない。
