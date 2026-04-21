/**
 * scripts/validate-llm-gemini.ts
 *
 * Gemini 3.1 Flash Lite Preview を **ゼロショット分類器** として使い、
 * MiniLM (scripts/validate-llm.ts) と同じテストセットで比較する。
 *
 * 比較軸:
 *   - Top-1 / Top-3 精度 (認知機能、タグ)
 *   - 中立投稿の false positive 率 (Gemini に "none" 選択肢を与える)
 *   - 1 件あたりのレイテンシ (ネットワーク往復込み)
 *   - 呼び出し回数と推定コスト
 *
 * 実行:
 *   .env に GEMINI_API_KEY=... を設定
 *   pnpm validate:llm:gemini
 *
 * 出力: docs/data/llm-benchmark-gemini.md
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────
// 設定
// ─────────────────────────────────────────────────

const MODEL_ID = 'gemini-3.1-flash-lite-preview' as const;
const COGNITIVE_FUNCTIONS = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'] as const;
const TAGS = ['question', 'distress', 'goodnews', 'humor', 'analysis', 'opinion', 'underseen', 'fresh', 'debated'] as const;
const NONE_LABEL = 'none';

const THROTTLE_MS = 250;     // 呼び出し間隔 (レート制限対策)
const MAX_RETRIES = 3;
const ROOT = new URL('..', import.meta.url).pathname;

if (!process.env.GEMINI_API_KEY) {
  console.error('エラー: .env に GEMINI_API_KEY を設定してください');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─────────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────────

interface LabeledPost { text: string; label: string }
interface NeutralPost { text: string }

interface Prediction {
  top1: string;
  topN: string[];
  raw: string;
  latencyMs: number;
}

interface TaskMetrics {
  total: number;
  top1Accuracy: number;
  top3Accuracy: number;
  f1PerClass: Record<string, number>;
  confusionMatrix: Record<string, Record<string, number>>;
}

interface BenchmarkResult {
  modelId: string;
  cognitive: TaskMetrics;
  tag: TaskMetrics;
  neutral: {
    cognitiveFpRate: number;   // "none" 以外を top1 に選んだ率
    tagFpRate: number;
  };
  latency: {
    count: number;
    p50: number;
    p95: number;
    mean: number;
  };
  tokens: { input: number; output: number };
  failures: number;
}

// ─────────────────────────────────────────────────
// データロード
// ─────────────────────────────────────────────────

function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) throw new Error(`見つかりません: ${path}`);
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('//'))
    .map(l => JSON.parse(l) as T);
}

// ─────────────────────────────────────────────────
// Gemini API 呼び出し
// ─────────────────────────────────────────────────

function buildCognitivePrompt(text: string, includeNone: boolean): string {
  const options = includeNone
    ? [...COGNITIVE_FUNCTIONS, NONE_LABEL]
    : COGNITIVE_FUNCTIONS;
  return `以下の投稿を、ユング派の認知機能のうち最も前面に出ているものでランク付けしてください。

認知機能の定義:
- Ni (内向的直観): 表面の奥にある本質・パターン・未来のビジョンの直感
- Ne (外向的直観): 連想・可能性の列挙、異分野の接続、アイデアの発散
- Si (内向的感覚): 記憶・既知の詳細・伝統・積み上げた経験への信頼
- Se (外向的感覚): 今この瞬間の感覚、身体性、即時反応、現場対応
- Ti (内向的思考): 内的論理体系、定義の精密化、整合性の追求
- Te (外向的思考): 効率・結果・外的秩序化・意思決定・実行
- Fi (内向的感情): 個人的な価値観、真正性、内なる倫理
- Fe (外向的感情): 場の調和、他者の感情への配慮、社会的連結
${includeNone ? '- none: どの認知機能も強く出ていない中立的な投稿' : ''}

投稿: "${text}"

上位 3 つを該当度の高い順にランク付けし、JSON オブジェクトのみを返してください (説明文なし):
{"ranked": ["${includeNone ? 'none' : 'Ti'}", "Te", "Ni"]}`;
}

function buildTagPrompt(text: string, includeNone: boolean): string {
  const options = includeNone ? [...TAGS, NONE_LABEL] : TAGS;
  return `以下の投稿のトーンとして最も近いものをランク付けしてください。

カテゴリ:
- question: 問いかけ、質問
- distress: つらさ、不安、助けを求めるトーン
- goodnews: 嬉しい出来事、達成、祝福
- humor: 笑い、自虐、軽い観察
- analysis: 分析、考察、論理的整理
- opinion: 主張、断定的な意見
- underseen: 静かで良質な、埋もれやすい観察
- fresh: 時事性、今まさに起きていること
- debated: 議論や論争を引き起こすテーマ
${includeNone ? '- none: 上記どれにも強く属さない日常的/中立的な投稿' : ''}

投稿: "${text}"

上位 3 つを該当度の高い順にランク付けし、JSON オブジェクトのみを返してください (説明文なし):
{"ranked": ["${includeNone ? 'none' : 'humor'}", "opinion", "analysis"]}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function classify(
  prompt: string,
  validLabels: readonly string[],
): Promise<{ prediction: Prediction; usage: { in: number; out: number } }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const t0 = performance.now();
      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      });
      const latencyMs = performance.now() - t0;

      const text = response.text?.trim() ?? '';
      const usage = {
        in: response.usageMetadata?.promptTokenCount ?? 0,
        out: response.usageMetadata?.candidatesTokenCount ?? 0,
      };

      // JSON パース
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : text;
      const parsed = JSON.parse(jsonStr) as { ranked: string[] };
      const ranked = (parsed.ranked ?? [])
        .map(s => String(s).trim())
        .filter(s => validLabels.includes(s as never));

      if (ranked.length === 0) throw new Error(`無効なラベル: ${text}`);

      return {
        prediction: {
          top1: ranked[0],
          topN: ranked.slice(0, 3),
          raw: text,
          latencyMs,
        },
        usage,
      };
    } catch (e) {
      lastError = e;
      await sleep(1000 * (attempt + 1)); // バックオフ
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────
// 評価ロジック (validate-llm.ts と同じ)
// ─────────────────────────────────────────────────

function computeMetrics(
  testSet: LabeledPost[],
  predictions: Prediction[],
  classes: readonly string[],
): TaskMetrics {
  const total = testSet.length;
  let top1Hits = 0;
  let top3Hits = 0;

  const confusion: Record<string, Record<string, number>> = {};
  for (const c of classes) {
    confusion[c] = {};
    for (const c2 of classes) confusion[c][c2] = 0;
  }

  for (let i = 0; i < total; i++) {
    const actual = testSet[i].label;
    const predicted = predictions[i].top1;
    const topN = predictions[i].topN;

    if (actual === predicted) top1Hits++;
    if (topN.includes(actual)) top3Hits++;

    if (confusion[actual] && confusion[actual][predicted] !== undefined) {
      confusion[actual][predicted]++;
    }
  }

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
    top3Accuracy: top3Hits / total,
    f1PerClass: f1,
    confusionMatrix: confusion,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

// ─────────────────────────────────────────────────
// メイン
// ─────────────────────────────────────────────────

async function evaluate(): Promise<BenchmarkResult> {
  const cogTestSet = loadJsonl<LabeledPost>(join(ROOT, 'docs/data/validation/cognitive_labeled.jsonl'));
  const tagTestSet = loadJsonl<LabeledPost>(join(ROOT, 'docs/data/validation/tag_labeled.jsonl'));
  const neutralSet = loadJsonl<NeutralPost>(join(ROOT, 'docs/data/validation/neutral.jsonl'));

  console.log(`モデル: ${MODEL_ID}`);
  console.log(`認知テスト: ${cogTestSet.length}, タグテスト: ${tagTestSet.length}, 中立: ${neutralSet.length}`);
  console.log(`推定呼び出し数: ${cogTestSet.length + tagTestSet.length + neutralSet.length * 2}`);
  console.log('');

  const latencies: number[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let failures = 0;

  // 認知機能テスト
  console.log(`[認知機能] ${cogTestSet.length} 件を分類...`);
  const cogPreds: Prediction[] = [];
  for (let i = 0; i < cogTestSet.length; i++) {
    const post = cogTestSet[i];
    try {
      const { prediction, usage } = await classify(
        buildCognitivePrompt(post.text, false),
        COGNITIVE_FUNCTIONS,
      );
      cogPreds.push(prediction);
      latencies.push(prediction.latencyMs);
      totalIn += usage.in;
      totalOut += usage.out;
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1} / ${cogTestSet.length}`);
    } catch (e) {
      failures++;
      cogPreds.push({ top1: '_error_', topN: [], raw: String(e), latencyMs: 0 });
    }
    await sleep(THROTTLE_MS);
  }

  // タグテスト
  console.log(`[タグ] ${tagTestSet.length} 件を分類...`);
  const tagPreds: Prediction[] = [];
  for (let i = 0; i < tagTestSet.length; i++) {
    const post = tagTestSet[i];
    try {
      const { prediction, usage } = await classify(
        buildTagPrompt(post.text, false),
        TAGS,
      );
      tagPreds.push(prediction);
      latencies.push(prediction.latencyMs);
      totalIn += usage.in;
      totalOut += usage.out;
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1} / ${tagTestSet.length}`);
    } catch (e) {
      failures++;
      tagPreds.push({ top1: '_error_', topN: [], raw: String(e), latencyMs: 0 });
    }
    await sleep(THROTTLE_MS);
  }

  // 中立 (認知機能、none オプション付き)
  console.log(`[中立 → 認知機能] ${neutralSet.length} 件...`);
  const neutralCogPreds: Prediction[] = [];
  for (let i = 0; i < neutralSet.length; i++) {
    const post = neutralSet[i];
    try {
      const { prediction, usage } = await classify(
        buildCognitivePrompt(post.text, true),
        [...COGNITIVE_FUNCTIONS, NONE_LABEL],
      );
      neutralCogPreds.push(prediction);
      latencies.push(prediction.latencyMs);
      totalIn += usage.in;
      totalOut += usage.out;
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1} / ${neutralSet.length}`);
    } catch (e) {
      failures++;
      neutralCogPreds.push({ top1: NONE_LABEL, topN: [NONE_LABEL], raw: String(e), latencyMs: 0 });
    }
    await sleep(THROTTLE_MS);
  }

  // 中立 (タグ、none オプション付き)
  console.log(`[中立 → タグ] ${neutralSet.length} 件...`);
  const neutralTagPreds: Prediction[] = [];
  for (let i = 0; i < neutralSet.length; i++) {
    const post = neutralSet[i];
    try {
      const { prediction, usage } = await classify(
        buildTagPrompt(post.text, true),
        [...TAGS, NONE_LABEL],
      );
      neutralTagPreds.push(prediction);
      latencies.push(prediction.latencyMs);
      totalIn += usage.in;
      totalOut += usage.out;
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1} / ${neutralSet.length}`);
    } catch (e) {
      failures++;
      neutralTagPreds.push({ top1: NONE_LABEL, topN: [NONE_LABEL], raw: String(e), latencyMs: 0 });
    }
    await sleep(THROTTLE_MS);
  }

  // 指標計算
  const cognitive = computeMetrics(cogTestSet, cogPreds, COGNITIVE_FUNCTIONS);
  const tag = computeMetrics(tagTestSet, tagPreds, TAGS);
  const neutralCogFp = neutralCogPreds.filter(p => p.top1 !== NONE_LABEL).length / neutralCogPreds.length;
  const neutralTagFp = neutralTagPreds.filter(p => p.top1 !== NONE_LABEL).length / neutralTagPreds.length;

  latencies.sort((a, b) => a - b);
  const mean = latencies.reduce((s, v) => s + v, 0) / latencies.length;

  return {
    modelId: MODEL_ID,
    cognitive,
    tag,
    neutral: { cognitiveFpRate: neutralCogFp, tagFpRate: neutralTagFp },
    latency: {
      count: latencies.length,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      mean,
    },
    tokens: { input: totalIn, output: totalOut },
    failures,
  };
}

// ─────────────────────────────────────────────────
// レポート
// ─────────────────────────────────────────────────

function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }
function ms(v: number): string { return `${v.toFixed(0)}ms`; }

function renderMarkdown(r: BenchmarkResult): string {
  const lines: string[] = [];
  lines.push('# Gemini 3.1 Flash Lite Preview ベンチマーク');
  lines.push('');
  lines.push('11-validation.md §実験 1 の比較。`scripts/validate-llm-gemini.ts` で生成。');
  lines.push('');
  lines.push(`- モデル: \`${r.modelId}\``);
  lines.push(`- 生成日時: ${new Date().toISOString()}`);
  lines.push(`- 方式: ゼロショット分類 (JSON モード、temperature=0)`);
  lines.push(`- 呼び出し失敗: ${r.failures} 件`);
  lines.push('');

  lines.push('## 指標');
  lines.push('');
  lines.push('| 指標 | 値 | 基準 | 判定 |');
  lines.push('|---|---|---|---|');
  lines.push(`| 認知機能 Top-1 | ${pct(r.cognitive.top1Accuracy)} | - | - |`);
  lines.push(`| 認知機能 Top-3 | ${pct(r.cognitive.top3Accuracy)} | ≥ 65% | ${r.cognitive.top3Accuracy >= 0.65 ? '✓' : '✗'} |`);
  lines.push(`| タグ Top-1 | ${pct(r.tag.top1Accuracy)} | ≥ 70% | ${r.tag.top1Accuracy >= 0.70 ? '✓' : '✗'} |`);
  lines.push(`| タグ Top-3 | ${pct(r.tag.top3Accuracy)} | - | - |`);
  lines.push(`| 中立 FP (認知) | ${pct(r.neutral.cognitiveFpRate)} | ≤ 30% | ${r.neutral.cognitiveFpRate <= 0.30 ? '✓' : '✗'} |`);
  lines.push(`| 中立 FP (タグ) | ${pct(r.neutral.tagFpRate)} | ≤ 30% | ${r.neutral.tagFpRate <= 0.30 ? '✓' : '✗'} |`);
  lines.push(`| p50 レイテンシ | ${ms(r.latency.p50)} | - | - |`);
  lines.push(`| p95 レイテンシ | ${ms(r.latency.p95)} | - | - |`);
  lines.push(`| 入力トークン合計 | ${r.tokens.input.toLocaleString()} | - | - |`);
  lines.push(`| 出力トークン合計 | ${r.tokens.output.toLocaleString()} | - | - |`);
  lines.push('');

  lines.push('## MiniLM との比較 (docs/data/llm-benchmark.md から転記)');
  lines.push('');
  lines.push('| 指標 | MiniLM (ローカル) | Gemini 3.1 Flash Lite |');
  lines.push('|---|---|---|');
  lines.push(`| 認知 Top-3 | 97.5% | ${pct(r.cognitive.top3Accuracy)} |`);
  lines.push(`| タグ Top-1 | 68.9% | ${pct(r.tag.top1Accuracy)} |`);
  lines.push(`| タグ Top-3 | 90.0% | ${pct(r.tag.top3Accuracy)} |`);
  lines.push(`| 中立 FP (認知) | 2.4% | ${pct(r.neutral.cognitiveFpRate)} |`);
  lines.push(`| 中立 FP (タグ) | 4.9% | ${pct(r.neutral.tagFpRate)} |`);
  lines.push(`| p95 レイテンシ | 1.9ms (WASM) | ${ms(r.latency.p95)} (ネットワーク込み) |`);
  lines.push(`| 呼び出しコスト | ゼロ | in: ${r.tokens.input.toLocaleString()}, out: ${r.tokens.output.toLocaleString()} tok |`);
  lines.push('');

  lines.push('## 認知機能 F1');
  lines.push('');
  lines.push('| 機能 | F1 |');
  lines.push('|---|---|');
  for (const [k, v] of Object.entries(r.cognitive.f1PerClass)) {
    lines.push(`| ${k} | ${v.toFixed(3)} |`);
  }
  lines.push('');

  lines.push('## 認知機能 混同行列 (行=正解, 列=予測)');
  lines.push('');
  lines.push(`| 正解\\予測 | ${COGNITIVE_FUNCTIONS.join(' | ')} |`);
  lines.push('|' + Array(COGNITIVE_FUNCTIONS.length + 1).fill('---').join('|') + '|');
  for (const actual of COGNITIVE_FUNCTIONS) {
    const row = [actual, ...COGNITIVE_FUNCTIONS.map(p => String(r.cognitive.confusionMatrix[actual]?.[p] ?? 0))];
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## タグ F1');
  lines.push('');
  lines.push('| タグ | F1 |');
  lines.push('|---|---|');
  for (const [k, v] of Object.entries(r.tag.f1PerClass)) {
    lines.push(`| ${k} | ${v.toFixed(3)} |`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────
// 実行
// ─────────────────────────────────────────────────

(async () => {
  try {
    const r = await evaluate();

    console.log('\n═══════════════════════════════════════════════════');
    console.log('結果サマリー');
    console.log('═══════════════════════════════════════════════════');
    console.log(`認知 Top-1:      ${pct(r.cognitive.top1Accuracy)}`);
    console.log(`認知 Top-3:      ${pct(r.cognitive.top3Accuracy)}`);
    console.log(`タグ Top-1:      ${pct(r.tag.top1Accuracy)}`);
    console.log(`タグ Top-3:      ${pct(r.tag.top3Accuracy)}`);
    console.log(`中立 FP (認知):  ${pct(r.neutral.cognitiveFpRate)}`);
    console.log(`中立 FP (タグ):  ${pct(r.neutral.tagFpRate)}`);
    console.log(`p50 / p95:       ${ms(r.latency.p50)} / ${ms(r.latency.p95)}`);
    console.log(`トークン合計:    in ${r.tokens.input.toLocaleString()}, out ${r.tokens.output.toLocaleString()}`);
    console.log(`失敗:            ${r.failures}`);

    const md = renderMarkdown(r);
    const outPath = join(ROOT, 'docs/data/llm-benchmark-gemini.md');
    writeFileSync(outPath, md);
    console.log(`\n詳細レポート: ${outPath}`);
  } catch (e) {
    console.error('致命的エラー:', e);
    process.exit(1);
  }
})();
