/**
 * scripts/validate-llm.ts
 *
 * Browser LLM (埋め込みモデル) の日本語分類精度を検証する。
 * 11-validation.md §実験 1 のプロトコルを実装する。
 *
 * 候補モデルを順にロードし、以下を計測する:
 *  - 認知機能 (8 クラス) の Top-1 / Top-3 精度
 *  - タグ (9 クラス) の Top-1 / Top-3 精度
 *  - 中立投稿に対する閾値越え (false positive) 率
 *  - 1 件あたりの埋め込みレイテンシ (p50 / p95, WASM Node 環境)
 *  - モデルロード時間
 *
 * 出力:
 *  - stdout: モデルごとのサマリー表
 *  - docs/data/llm-benchmark.md: 結果の詳細レポート
 *
 * 実行:
 *   pnpm add -D @huggingface/transformers tsx
 *   pnpm tsx scripts/validate-llm.ts
 *
 * 必要なデータファイル:
 *   packages/prompts/cognitive/{Ni,Ne,Si,Se,Ti,Te,Fi,Fe}.json  (プロトタイプ 各 N 件)
 *   packages/prompts/tags.json  (または docs/data/tags.json のフォールバック)
 *   docs/data/validation/cognitive_labeled.jsonl
 *   docs/data/validation/tag_labeled.jsonl
 *   docs/data/validation/neutral.jsonl
 *
 * データフォーマットは docs/data/validation/README.md を参照。
 */

import { pipeline, env } from '@huggingface/transformers';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────
// 設定
// ─────────────────────────────────────────────────

interface Candidate {
  id: string;
  dtype: 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4';
  needsE5Prefix: boolean;
}

const CANDIDATES: Candidate[] = [
  // Japanese 特化 (cl-nagoya/ruri-v3 系、ModernBERT-ja ベース、JMTEB SOTA クラス)
  { id: 'sirasagi62/ruri-v3-30m-ONNX',  dtype: 'int8', needsE5Prefix: false },
  { id: 'sirasagi62/ruri-v3-70m-ONNX',  dtype: 'int8', needsE5Prefix: false },
  { id: 'sirasagi62/ruri-v3-130m-ONNX', dtype: 'int8', needsE5Prefix: false },
  // 多言語ベースライン (既存実証)
  { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dtype: 'q8', needsE5Prefix: false },
  { id: 'Xenova/multilingual-e5-small', dtype: 'q8', needsE5Prefix: true },
];

const COGNITIVE_FUNCTIONS = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'] as const;
const TAGS = ['question', 'distress', 'goodnews', 'humor', 'analysis', 'opinion', 'underseen', 'fresh', 'debated'] as const;

const TAG_CLASSIFICATION_THRESHOLD = 0.7; // tags.json の classificationMethod と合わせる
const TOP_N = 3;                          // 04-diagnosis.md の Top-3 平均採用
const ROOT = new URL('..', import.meta.url).pathname;

// Transformers.js の警告を抑制 (Node 環境)
env.allowLocalModels = false;
env.useBrowserCache = false;

// ─────────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────────

interface LabeledPost {
  text: string;
  label: string;
}

interface NeutralPost {
  text: string;
}

interface Prediction {
  /** 予測ラベル (top-1) */
  top1: string;
  /** 上位 N 件のラベルとスコア */
  topN: Array<{ label: string; score: number }>;
  /** 全クラスに対するスコア (Top-N 平均) */
  scoresPerClass: Record<string, number>;
}

interface ModelResult {
  modelId: string;
  loadTimeMs: number;
  cognitive: TaskMetrics;
  tag: TaskMetrics;
  neutral: {
    /** 認知機能で閾値超えしたサンプル割合 */
    cognitiveFpRate: number;
    /** タグで閾値超えしたサンプル割合 */
    tagFpRate: number;
  };
  latency: {
    count: number;
    p50: number;
    p95: number;
    mean: number;
  };
}

interface TaskMetrics {
  total: number;
  top1Accuracy: number;
  topNAccuracy: number;
  f1PerClass: Record<string, number>;
  confusionMatrix: Record<string, Record<string, number>>;
}

// ─────────────────────────────────────────────────
// データロード
// ─────────────────────────────────────────────────

function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) {
    throw new Error(`データファイルが見つかりません: ${path}\n  docs/data/validation/README.md を参照して用意してください。`);
  }
  const raw = readFileSync(path, 'utf-8');
  return raw
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('//'))
    .map(line => JSON.parse(line) as T);
}

function loadJson<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`データファイルが見つかりません: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function loadCognitivePrototypes(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const fn of COGNITIVE_FUNCTIONS) {
    const path = join(ROOT, 'packages/prompts/cognitive', `${fn}.json`);
    if (!existsSync(path)) {
      throw new Error(
        `認知機能プロトタイプが見つかりません: ${path}\n` +
        `  packages/prompts/cognitive/${COGNITIVE_FUNCTIONS.join('|')}.json を用意してください。\n` +
        `  形式: { "prototypes": [{ "text": "..." }, ...] }`
      );
    }
    const data = loadJson<{ prototypes: Array<{ text: string }> }>(path);
    result[fn] = data.prototypes.map(p => p.text);
  }
  return result;
}

function loadTagPrototypes(): Record<string, string[]> {
  const candidates = [
    join(ROOT, 'packages/prompts/tags.json'),
    join(ROOT, 'docs/data/tags.json'),
  ];
  const path = candidates.find(existsSync);
  if (!path) {
    throw new Error(`タグプロトタイプが見つかりません (探索先: ${candidates.join(', ')})`);
  }
  const data = loadJson<{ tags: Record<string, { prototypes: Array<{ text: string }> }> }>(path);
  const result: Record<string, string[]> = {};
  for (const tag of TAGS) {
    result[tag] = data.tags[tag]?.prototypes.map(p => p.text) ?? [];
    if (result[tag].length === 0) {
      throw new Error(`タグ "${tag}" のプロトタイプが空です (${path})`);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────
// 埋め込みユーティリティ
// ─────────────────────────────────────────────────

function applyE5Prefix(text: string, needsPrefix: boolean): string {
  // e5 系は "passage: " プレフィックスで大幅に精度向上する
  return needsPrefix ? `passage: ${text}` : text;
}

async function embedText(extractor: any, text: string, needsPrefix: boolean): Promise<Float32Array> {
  const out = await extractor(applyE5Prefix(text, needsPrefix), {
    pooling: 'mean',
    normalize: true,
  });
  return out.data as Float32Array;
}

async function embedBatch(
  extractor: any,
  texts: string[],
  needsPrefix: boolean,
): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  for (const t of texts) {
    results.push(await embedText(extractor, t, needsPrefix));
  }
  return results;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  // 正規化済み前提なので内積 = コサイン類似度
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ─────────────────────────────────────────────────
// 分類
// ─────────────────────────────────────────────────

function classify(
  vec: Float32Array,
  prototypesByLabel: Record<string, Float32Array[]>,
  topN: number,
): Prediction {
  const scoresPerClass: Record<string, number> = {};

  for (const [label, protos] of Object.entries(prototypesByLabel)) {
    const sims = protos.map(p => cosineSimilarity(vec, p)).sort((a, b) => b - a);
    const top = sims.slice(0, Math.min(topN, sims.length));
    const avg = top.reduce((s, v) => s + v, 0) / top.length;
    scoresPerClass[label] = avg;
  }

  const sorted = Object.entries(scoresPerClass)
    .sort(([, a], [, b]) => b - a)
    .map(([label, score]) => ({ label, score }));

  return {
    top1: sorted[0].label,
    topN: sorted.slice(0, topN),
    scoresPerClass,
  };
}

// ─────────────────────────────────────────────────
// 評価指標
// ─────────────────────────────────────────────────

function computeMetrics(
  testSet: LabeledPost[],
  predictions: Prediction[],
  classes: readonly string[],
): TaskMetrics {
  const total = testSet.length;
  let top1Hits = 0;
  let topNHits = 0;

  const confusion: Record<string, Record<string, number>> = {};
  for (const c of classes) {
    confusion[c] = {};
    for (const c2 of classes) confusion[c][c2] = 0;
  }

  for (let i = 0; i < total; i++) {
    const actual = testSet[i].label;
    const predicted = predictions[i].top1;
    const topNLabels = predictions[i].topN.map(t => t.label);

    if (actual === predicted) top1Hits++;
    if (topNLabels.includes(actual)) topNHits++;

    if (confusion[actual] && confusion[actual][predicted] !== undefined) {
      confusion[actual][predicted]++;
    }
  }

  // F1 per class
  const f1: Record<string, number> = {};
  for (const c of classes) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < total; i++) {
      const actual = testSet[i].label;
      const predicted = predictions[i].top1;
      if (actual === c && predicted === c) tp++;
      else if (actual !== c && predicted === c) fp++;
      else if (actual === c && predicted !== c) fn++;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    f1[c] = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  }

  return {
    total,
    top1Accuracy: top1Hits / total,
    topNAccuracy: topNHits / total,
    f1PerClass: f1,
    confusionMatrix: confusion,
  };
}

function computeFalsePositiveRate(
  predictions: Prediction[],
  threshold: number,
): number {
  const crossed = predictions.filter(p => p.topN[0].score >= threshold).length;
  return crossed / predictions.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[idx];
}

// ─────────────────────────────────────────────────
// 1 モデルの評価
// ─────────────────────────────────────────────────

async function evaluateModel(
  candidate: Candidate,
  cogProtoTexts: Record<string, string[]>,
  tagProtoTexts: Record<string, string[]>,
  cogTestSet: LabeledPost[],
  tagTestSet: LabeledPost[],
  neutralSet: NeutralPost[],
): Promise<ModelResult> {
  console.log(`\n[${candidate.id}] ロード中...`);
  const loadStart = performance.now();
  const extractor: any = await pipeline('feature-extraction', candidate.id, {
    dtype: candidate.dtype,
  });
  const loadTimeMs = performance.now() - loadStart;
  console.log(`  ロード完了 (${(loadTimeMs / 1000).toFixed(1)}s)`);

  // プロトタイプ埋め込み
  console.log(`  プロトタイプ埋め込み中...`);
  const cogProtos: Record<string, Float32Array[]> = {};
  for (const [fn, texts] of Object.entries(cogProtoTexts)) {
    cogProtos[fn] = await embedBatch(extractor, texts, candidate.needsE5Prefix);
  }
  const tagProtos: Record<string, Float32Array[]> = {};
  for (const [tag, texts] of Object.entries(tagProtoTexts)) {
    tagProtos[tag] = await embedBatch(extractor, texts, candidate.needsE5Prefix);
  }

  // テストセット埋め込み (レイテンシ計測)
  const latencies: number[] = [];
  const embedTestItem = async (text: string) => {
    const t = performance.now();
    const v = await embedText(extractor, text, candidate.needsE5Prefix);
    latencies.push(performance.now() - t);
    return v;
  };

  console.log(`  認知機能テスト埋め込み中 (${cogTestSet.length} 件)...`);
  const cogVecs: Float32Array[] = [];
  for (const p of cogTestSet) cogVecs.push(await embedTestItem(p.text));

  console.log(`  タグテスト埋め込み中 (${tagTestSet.length} 件)...`);
  const tagVecs: Float32Array[] = [];
  for (const p of tagTestSet) tagVecs.push(await embedTestItem(p.text));

  console.log(`  中立テスト埋め込み中 (${neutralSet.length} 件)...`);
  const neutralVecs: Float32Array[] = [];
  for (const p of neutralSet) neutralVecs.push(await embedTestItem(p.text));

  // 分類
  const cogPreds = cogVecs.map(v => classify(v, cogProtos, TOP_N));
  const tagPreds = tagVecs.map(v => classify(v, tagProtos, TOP_N));
  const neutralCogPreds = neutralVecs.map(v => classify(v, cogProtos, 1));
  const neutralTagPreds = neutralVecs.map(v => classify(v, tagProtos, 1));

  // 指標
  const cognitive = computeMetrics(cogTestSet, cogPreds, COGNITIVE_FUNCTIONS);
  const tag = computeMetrics(tagTestSet, tagPreds, TAGS);
  const neutralCogFp = computeFalsePositiveRate(neutralCogPreds, TAG_CLASSIFICATION_THRESHOLD);
  const neutralTagFp = computeFalsePositiveRate(neutralTagPreds, TAG_CLASSIFICATION_THRESHOLD);

  latencies.sort((a, b) => a - b);
  const mean = latencies.reduce((s, v) => s + v, 0) / latencies.length;

  return {
    modelId: candidate.id,
    loadTimeMs,
    cognitive,
    tag,
    neutral: {
      cognitiveFpRate: neutralCogFp,
      tagFpRate: neutralTagFp,
    },
    latency: {
      count: latencies.length,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      mean,
    },
  };
}

// ─────────────────────────────────────────────────
// 出力
// ─────────────────────────────────────────────────

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function ms(v: number): string {
  return `${v.toFixed(1)}ms`;
}

function renderMarkdown(results: ModelResult[]): string {
  const lines: string[] = [];
  lines.push('# Browser LLM ベンチマーク結果');
  lines.push('');
  lines.push('11-validation.md §実験 1 の結果。`scripts/validate-llm.ts` で生成。');
  lines.push('');
  lines.push(`- 生成日時: ${new Date().toISOString()}`);
  lines.push(`- 実行環境: Node ${process.version} / ${process.platform} ${process.arch}`);
  lines.push(`- Transformers.js バックエンド: WASM (Node)`);
  lines.push(`- 注意: **p50 / p95 レイテンシは WASM Node 実行時の数値**。ブラウザ WebGPU はこれより速い (別途 scripts/validate-llm-browser.html で計測)`);
  lines.push('');

  // サマリー表
  lines.push('## サマリー');
  lines.push('');
  lines.push('| モデル | ロード | 認知 Top-1 | 認知 Top-3 | タグ Top-1 | タグ Top-3 | 中立 FP (認知) | 中立 FP (タグ) | p50 | p95 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(
      `| \`${r.modelId}\` | ${(r.loadTimeMs / 1000).toFixed(1)}s | ${pct(r.cognitive.top1Accuracy)} | ${pct(r.cognitive.topNAccuracy)} | ${pct(r.tag.top1Accuracy)} | ${pct(r.tag.topNAccuracy)} | ${pct(r.neutral.cognitiveFpRate)} | ${pct(r.neutral.tagFpRate)} | ${ms(r.latency.p50)} | ${ms(r.latency.p95)} |`
    );
  }
  lines.push('');

  // 合格基準
  lines.push('## 合格基準 (11-validation.md §実験 1)');
  lines.push('');
  lines.push('| 指標 | 閾値 |');
  lines.push('|---|---|');
  lines.push('| 認知機能 Top-3 精度 | 65% 以上 |');
  lines.push('| タグ Top-1 精度 | 70% 以上 |');
  lines.push('| 中立 false positive | 30% 以下 |');
  lines.push('| p95 レイテンシ (WebGPU) | 100ms 以下 ※別途計測 |');
  lines.push('| p95 レイテンシ (WASM) | 500ms 以下 |');
  lines.push('');

  // モデル別詳細
  for (const r of results) {
    lines.push(`## ${r.modelId}`);
    lines.push('');
    lines.push('### 認知機能 F1');
    lines.push('');
    lines.push('| 機能 | F1 |');
    lines.push('|---|---|');
    for (const [k, v] of Object.entries(r.cognitive.f1PerClass)) {
      lines.push(`| ${k} | ${v.toFixed(3)} |`);
    }
    lines.push('');
    lines.push('### 認知機能 混同行列 (行=正解, 列=予測)');
    lines.push('');
    const cogHeader = ['正解\\予測', ...COGNITIVE_FUNCTIONS].join(' | ');
    lines.push(`| ${cogHeader} |`);
    lines.push('|' + Array(COGNITIVE_FUNCTIONS.length + 1).fill('---').join('|') + '|');
    for (const actual of COGNITIVE_FUNCTIONS) {
      const row = [actual, ...COGNITIVE_FUNCTIONS.map(p => String(r.cognitive.confusionMatrix[actual]?.[p] ?? 0))];
      lines.push(`| ${row.join(' | ')} |`);
    }
    lines.push('');
    lines.push('### タグ F1');
    lines.push('');
    lines.push('| タグ | F1 |');
    lines.push('|---|---|');
    for (const [k, v] of Object.entries(r.tag.f1PerClass)) {
      lines.push(`| ${k} | ${v.toFixed(3)} |`);
    }
    lines.push('');
  }

  // 結論プレースホルダー
  lines.push('## 結論 (手動記入)');
  lines.push('');
  lines.push('採用モデル: **要記入**');
  lines.push('');
  lines.push('選定理由:');
  lines.push('- 要記入');
  lines.push('');
  lines.push('懸念事項:');
  lines.push('- 要記入');
  lines.push('');

  return lines.join('\n');
}

function renderSummaryConsole(results: ModelResult[]): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('サマリー');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const r of results) {
    console.log(`\n[${r.modelId}]`);
    console.log(`  ロード:              ${(r.loadTimeMs / 1000).toFixed(1)}s`);
    console.log(`  認知機能 Top-1:      ${pct(r.cognitive.top1Accuracy)}`);
    console.log(`  認知機能 Top-3:      ${pct(r.cognitive.topNAccuracy)}  ${r.cognitive.topNAccuracy >= 0.65 ? '✓' : '✗ (基準 65%)'}`);
    console.log(`  タグ Top-1:          ${pct(r.tag.top1Accuracy)}        ${r.tag.top1Accuracy >= 0.70 ? '✓' : '✗ (基準 70%)'}`);
    console.log(`  タグ Top-3:          ${pct(r.tag.topNAccuracy)}`);
    console.log(`  中立 FP (認知):      ${pct(r.neutral.cognitiveFpRate)}  ${r.neutral.cognitiveFpRate <= 0.30 ? '✓' : '✗ (基準 ≤30%)'}`);
    console.log(`  中立 FP (タグ):      ${pct(r.neutral.tagFpRate)}        ${r.neutral.tagFpRate <= 0.30 ? '✓' : '✗ (基準 ≤30%)'}`);
    console.log(`  p50 / p95 レイテンシ: ${ms(r.latency.p50)} / ${ms(r.latency.p95)} (WASM Node)`);
  }
}

// ─────────────────────────────────────────────────
// メイン
// ─────────────────────────────────────────────────

async function main() {
  console.log('Browser LLM 検証 (11-validation.md §実験 1)\n');

  // データロード
  console.log('データ読み込み中...');
  const cogProtoTexts = loadCognitivePrototypes();
  const tagProtoTexts = loadTagPrototypes();
  const cogTestSet = loadJsonl<LabeledPost>(join(ROOT, 'docs/data/validation/cognitive_labeled.jsonl'));
  const tagTestSet = loadJsonl<LabeledPost>(join(ROOT, 'docs/data/validation/tag_labeled.jsonl'));
  const neutralSet = loadJsonl<NeutralPost>(join(ROOT, 'docs/data/validation/neutral.jsonl'));

  console.log(`  認知機能プロトタイプ: ${COGNITIVE_FUNCTIONS.map(f => `${f}=${cogProtoTexts[f].length}`).join(', ')}`);
  console.log(`  タグプロトタイプ:     ${TAGS.map(t => `${t}=${tagProtoTexts[t].length}`).join(', ')}`);
  console.log(`  認知機能テスト:       ${cogTestSet.length} 件`);
  console.log(`  タグテスト:           ${tagTestSet.length} 件`);
  console.log(`  中立テスト:           ${neutralSet.length} 件`);

  // 各モデルを評価
  const results: ModelResult[] = [];
  for (const candidate of CANDIDATES) {
    try {
      const r = await evaluateModel(
        candidate,
        cogProtoTexts,
        tagProtoTexts,
        cogTestSet,
        tagTestSet,
        neutralSet,
      );
      results.push(r);
    } catch (e) {
      console.error(`\n[${candidate.id}] 失敗:`, e);
    }
  }

  if (results.length === 0) {
    console.error('\n結果なし。すべてのモデル評価が失敗しました。');
    process.exit(1);
  }

  // 出力
  renderSummaryConsole(results);

  const md = renderMarkdown(results);
  const outPath = join(ROOT, 'docs/data/llm-benchmark.md');
  writeFileSync(outPath, md);
  console.log(`\n詳細レポート: ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
