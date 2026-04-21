/**
 * scripts/validate-llm-minilm-sweep.ts
 *
 * MiniLM (採用候補) の閾値感度を可視化する。
 *
 * 以前の validate-llm.ts は閾値 0.7 固定で MiniLM の中立 FP = 2.4% / 4.9% を出した。
 * しかしこの数値は閾値を 0.7 に置いた結果にすぎず、MiniLM 自身が "判別不能" を
 * 返しているわけではない。
 *
 * Gemini の v1 テストが ranking バイアスで不公平だったのと同じく、MiniLM の
 * 閾値 0.7 も恣意的な設定。フェアな比較のため以下を計測する:
 *
 *   1. ラベル付き (認知機能 40, タグ 90) の最高類似度の分布
 *      → 「正解ラベルに割り当てるべき投稿は、どのくらいの類似度が出ているか」
 *   2. 中立 (123) の最高類似度の分布
 *      → 「中立的な日常投稿は、どのくらいの類似度で誤検知するか」
 *   3. 閾値を 0.3 〜 0.9 までスイープし、各閾値での以下を計算:
 *      - Top-1 精度 (閾値以上を確実に分類、以下を "none" 扱い → F1 計算に反映)
 *      - 中立 FP (閾値以上を "確信ある分類" とみなしたときの誤検知率)
 *      - True labeled → "none" 誤除外率
 *
 * 実行: pnpm tsx scripts/validate-llm-minilm-sweep.ts
 * 出力: docs/data/llm-benchmark-minilm-sweep.md
 */

import { pipeline, env } from '@huggingface/transformers';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// CLI 引数でモデル切替可能にする (デフォルト: MiniLM)
const MODEL_ID = process.argv[2] || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const DTYPE = (process.argv[3] ?? 'q8') as 'q8' | 'int8' | 'q4' | 'fp16';
const COGNITIVE_FUNCTIONS = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'] as const;
const TAGS = ['question', 'distress', 'goodnews', 'humor', 'analysis', 'opinion', 'underseen', 'fresh', 'debated'] as const;
const TOP_N = 3;
const ROOT = new URL('..', import.meta.url).pathname;
// Ruri 系は分布が全体的に高いので 0.5〜0.95 を広めに
const THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.82, 0.85, 0.87, 0.9, 0.92, 0.95];

env.allowLocalModels = false;
env.useBrowserCache = false;

interface LabeledPost { text: string; label: string }
interface NeutralPost { text: string }
interface Classification {
  top1: string;
  top1Score: number;
  scoresPerClass: Record<string, number>;
}

function loadJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf-8').split('\n').filter(l => l.trim() && !l.startsWith('//')).map(l => JSON.parse(l) as T);
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s;
}

async function embed(extractor: any, text: string): Promise<Float32Array> {
  const o = await extractor(text, { pooling: 'mean', normalize: true });
  return o.data as Float32Array;
}

function classifyWithTopN(vec: Float32Array, protos: Record<string, Float32Array[]>, topN: number): Classification {
  const scoresPerClass: Record<string, number> = {};
  for (const [label, vecs] of Object.entries(protos)) {
    const sims = vecs.map(p => cosine(vec, p)).sort((a, b) => b - a).slice(0, topN);
    scoresPerClass[label] = sims.reduce((s, v) => s + v, 0) / sims.length;
  }
  const sorted = Object.entries(scoresPerClass).sort(([, a], [, b]) => b - a);
  return { top1: sorted[0][0], top1Score: sorted[0][1], scoresPerClass };
}

function loadCogProtos(): Record<string, string[]> {
  const r: Record<string, string[]> = {};
  for (const f of COGNITIVE_FUNCTIONS) {
    const p = loadJson<{ prototypes: Array<{ text: string }> }>(join(ROOT, 'packages/prompts/cognitive', `${f}.json`));
    r[f] = p.prototypes.map(x => x.text);
  }
  return r;
}
function loadTagProtos(): Record<string, string[]> {
  const p = loadJson<{ tags: Record<string, { prototypes: Array<{ text: string }> }> }>(join(ROOT, 'docs/data/tags.json'));
  const r: Record<string, string[]> = {};
  for (const t of TAGS) r[t] = p.tags[t].prototypes.map(x => x.text);
  return r;
}

function histogram(values: number[], bins: number[]): number[] {
  const counts = new Array(bins.length - 1).fill(0);
  for (const v of values) {
    for (let i = 0; i < bins.length - 1; i++) {
      if (v >= bins[i] && v < bins[i + 1]) { counts[i]++; break; }
    }
  }
  return counts;
}

function stats(values: number[]): { mean: number; median: number; min: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((s, v) => s + v, 0) / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

(async () => {
  console.log(`モデル: ${MODEL_ID} (dtype=${DTYPE})`);
  console.log('ロード中...');
  const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: DTYPE });

  console.log('データロード中...');
  const cogProtoTexts = loadCogProtos();
  const tagProtoTexts = loadTagProtos();
  const cogTest = loadJsonl<LabeledPost>(join(ROOT, 'docs/data/validation/cognitive_labeled.jsonl'));
  const tagTest = loadJsonl<LabeledPost>(join(ROOT, 'docs/data/validation/tag_labeled.jsonl'));
  const neutral = loadJsonl<NeutralPost>(join(ROOT, 'docs/data/validation/neutral.jsonl'));

  console.log('プロトタイプ埋め込み中...');
  const cogProtos: Record<string, Float32Array[]> = {};
  for (const [k, v] of Object.entries(cogProtoTexts)) cogProtos[k] = await Promise.all(v.map(t => embed(extractor, t)));
  const tagProtos: Record<string, Float32Array[]> = {};
  for (const [k, v] of Object.entries(tagProtoTexts)) tagProtos[k] = await Promise.all(v.map(t => embed(extractor, t)));

  console.log('テスト埋め込みと分類中...');
  const cogTestCls: Array<{ actual: string; cls: Classification }> = [];
  for (const p of cogTest) cogTestCls.push({ actual: p.label, cls: classifyWithTopN(await embed(extractor, p.text), cogProtos, TOP_N) });
  const tagTestCls: Array<{ actual: string; cls: Classification }> = [];
  for (const p of tagTest) tagTestCls.push({ actual: p.label, cls: classifyWithTopN(await embed(extractor, p.text), tagProtos, TOP_N) });
  const neutralCogCls: Classification[] = [];
  for (const p of neutral) neutralCogCls.push(classifyWithTopN(await embed(extractor, p.text), cogProtos, TOP_N));
  const neutralTagCls: Classification[] = [];
  for (const p of neutral) neutralTagCls.push(classifyWithTopN(await embed(extractor, p.text), tagProtos, TOP_N));

  // スコア分布
  const cogLabeledScores = cogTestCls.map(x => x.cls.top1Score);
  const tagLabeledScores = tagTestCls.map(x => x.cls.top1Score);
  const neutralCogScores = neutralCogCls.map(x => x.top1Score);
  const neutralTagScores = neutralTagCls.map(x => x.top1Score);

  // 閾値スイープ
  interface SweepRow {
    threshold: number;
    cogTop1: number;
    cogTop1OfPassing: number;
    cogLabeledAsNone: number;
    neutralCogFp: number;
    tagTop1: number;
    tagTop1OfPassing: number;
    tagLabeledAsNone: number;
    neutralTagFp: number;
  }
  const sweep: SweepRow[] = [];
  for (const t of THRESHOLDS) {
    // 認知: ラベル付き
    let cogPassing = 0, cogCorrectInPassing = 0, cogLabeledAsNone = 0;
    for (const x of cogTestCls) {
      if (x.cls.top1Score >= t) {
        cogPassing++;
        if (x.cls.top1 === x.actual) cogCorrectInPassing++;
      } else {
        cogLabeledAsNone++; // 正解ラベルがあるのに閾値不達 → 誤って "none" に
      }
    }
    const cogTop1 = cogTestCls.filter(x => x.cls.top1Score >= t && x.cls.top1 === x.actual).length / cogTestCls.length;
    const cogTop1OfPassing = cogPassing === 0 ? 0 : cogCorrectInPassing / cogPassing;

    const neutralCogFp = neutralCogCls.filter(x => x.top1Score >= t).length / neutralCogCls.length;

    // タグ: 同じく
    let tagPassing = 0, tagCorrectInPassing = 0, tagLabeledAsNone = 0;
    for (const x of tagTestCls) {
      if (x.cls.top1Score >= t) {
        tagPassing++;
        if (x.cls.top1 === x.actual) tagCorrectInPassing++;
      } else {
        tagLabeledAsNone++;
      }
    }
    const tagTop1 = tagTestCls.filter(x => x.cls.top1Score >= t && x.cls.top1 === x.actual).length / tagTestCls.length;
    const tagTop1OfPassing = tagPassing === 0 ? 0 : tagCorrectInPassing / tagPassing;

    const neutralTagFp = neutralTagCls.filter(x => x.top1Score >= t).length / neutralTagCls.length;

    sweep.push({
      threshold: t,
      cogTop1, cogTop1OfPassing,
      cogLabeledAsNone: cogLabeledAsNone / cogTestCls.length,
      neutralCogFp,
      tagTop1, tagTop1OfPassing,
      tagLabeledAsNone: tagLabeledAsNone / tagTestCls.length,
      neutralTagFp,
    });
  }

  // コンソール
  console.log('\n═══════════════════════════════════════════════════');
  console.log('MiniLM スコア分布');
  console.log('═══════════════════════════════════════════════════');
  console.log(`ラベル付き認知 top-1 score (n=${cogLabeledScores.length}): ${JSON.stringify(stats(cogLabeledScores))}`);
  console.log(`ラベル付きタグ top-1 score (n=${tagLabeledScores.length}): ${JSON.stringify(stats(tagLabeledScores))}`);
  console.log(`中立 認知 top-1 score (n=${neutralCogScores.length}): ${JSON.stringify(stats(neutralCogScores))}`);
  console.log(`中立 タグ top-1 score (n=${neutralTagScores.length}): ${JSON.stringify(stats(neutralTagScores))}`);

  console.log('\n閾値スイープ:');
  console.log('threshold | cog Top1 | cog(passing) | cog→none | neut cog FP | tag Top1 | tag(passing) | tag→none | neut tag FP');
  for (const r of sweep) {
    const fmt = (v: number) => (v * 100).toFixed(1).padStart(5) + '%';
    console.log(`   ${r.threshold.toFixed(2)}   | ${fmt(r.cogTop1)} |   ${fmt(r.cogTop1OfPassing)}    | ${fmt(r.cogLabeledAsNone)} |   ${fmt(r.neutralCogFp)}    | ${fmt(r.tagTop1)} |   ${fmt(r.tagTop1OfPassing)}    | ${fmt(r.tagLabeledAsNone)} |   ${fmt(r.neutralTagFp)}`);
  }

  // Markdown
  const lines: string[] = [];
  lines.push('# MiniLM 閾値感度分析');
  lines.push('');
  lines.push('11-validation.md §実験 1 の公平性確認。以前の結果は閾値 0.7 固定だったため、MiniLM が「none」を判断する仕組みはあくまで外部閾値である。本分析は閾値を 0.3-0.9 でスイープして感度を可視化する。');
  lines.push('');
  lines.push(`- モデル: \`${MODEL_ID}\``);
  lines.push(`- 生成: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## スコア分布 (top-1 コサイン類似度、Top-3 平均)');
  lines.push('');
  lines.push('| セット | n | min | median | mean | max |');
  lines.push('|---|---|---|---|---|---|');
  const s1 = stats(cogLabeledScores);
  const s2 = stats(tagLabeledScores);
  const s3 = stats(neutralCogScores);
  const s4 = stats(neutralTagScores);
  lines.push(`| ラベル付き認知 (正解含む) | ${cogLabeledScores.length} | ${s1.min.toFixed(3)} | ${s1.median.toFixed(3)} | ${s1.mean.toFixed(3)} | ${s1.max.toFixed(3)} |`);
  lines.push(`| ラベル付きタグ (正解含む) | ${tagLabeledScores.length} | ${s2.min.toFixed(3)} | ${s2.median.toFixed(3)} | ${s2.mean.toFixed(3)} | ${s2.max.toFixed(3)} |`);
  lines.push(`| 中立 → 認知 (誤検知候補) | ${neutralCogScores.length} | ${s3.min.toFixed(3)} | ${s3.median.toFixed(3)} | ${s3.mean.toFixed(3)} | ${s3.max.toFixed(3)} |`);
  lines.push(`| 中立 → タグ (誤検知候補) | ${neutralTagScores.length} | ${s4.min.toFixed(3)} | ${s4.median.toFixed(3)} | ${s4.mean.toFixed(3)} | ${s4.max.toFixed(3)} |`);
  lines.push('');
  lines.push('**ラベル付きセットと中立セットのスコア分布に差があれば、閾値で分離可能**。mean や median の差を確認。');
  lines.push('');
  lines.push('## 閾値スイープ');
  lines.push('');
  lines.push('| 閾値 | 認知 Top-1 (全体) | 認知 Top-1 (閾値通過のみ) | 認知 ラベル→none 漏れ | 中立 認知 FP | タグ Top-1 (全体) | タグ Top-1 (閾値通過のみ) | タグ ラベル→none 漏れ | 中立 タグ FP |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of sweep) {
    const f = (v: number) => (v * 100).toFixed(1) + '%';
    lines.push(`| ${r.threshold} | ${f(r.cogTop1)} | ${f(r.cogTop1OfPassing)} | ${f(r.cogLabeledAsNone)} | ${f(r.neutralCogFp)} | ${f(r.tagTop1)} | ${f(r.tagTop1OfPassing)} | ${f(r.tagLabeledAsNone)} | ${f(r.neutralTagFp)} |`);
  }
  lines.push('');
  lines.push('### 列の意味');
  lines.push('');
  lines.push('- **Top-1 (全体)**: 全ラベル付きサンプル中、閾値 ≥ のうえで正解と一致した割合 (閾値未達は不正解扱い)');
  lines.push('- **Top-1 (閾値通過のみ)**: 閾値を通過したラベル付きサンプルの中で正解一致率 (= Precision 的指標)');
  lines.push('- **ラベル→none 漏れ**: ラベルが付いているのに閾値未達で "none" 扱いになった割合 (= Recall ロス)');
  lines.push('- **中立 FP**: 中立投稿のうち、閾値を超えて何らかのラベルを誤って得た割合');
  lines.push('');
  lines.push('## MiniLM の「none 判断能力」の実態');
  lines.push('');
  lines.push('MiniLM は確率的に "none" を返すのではなく、**スコアの連続値**を返す。外部から閾値を当てることで "none" 判定を実現している。');
  lines.push('');
  lines.push('言い換えると:');
  lines.push('- ラベル付き投稿のスコア中央値 ≒ プロトタイプとの本物のマッチ強度');
  lines.push('- 中立投稿のスコア中央値 ≒ 偶然の類似 / プロトタイプの汎用性による誤信号');
  lines.push('- この 2 つの分布の **重なり具合** が、分離可能性を決定する');
  lines.push('');
  lines.push('## Gemini v2 との比較ポイント');
  lines.push('');
  lines.push('Gemini は「none と判断する能力」を直接持っている (かは v2 スクリプトの結果次第)。MiniLM は分布の重なりを閾値で切る。どちらが安全で実用的かは:');
  lines.push('- **MiniLM**: 閾値を動かせば FP / 漏れのトレードオフを調整可能 (運用可塑性あり)');
  lines.push('- **Gemini**: 判断能力が強ければ追加パラメータ不要で「読み取れない」を返せる');
  lines.push('');
  lines.push('## 推奨閾値の再検討');
  lines.push('');
  lines.push('上記スイープを見て:');
  lines.push('- **認知機能**: ラベル付きセットのスコア分布と中立セットの分布が大きく離れているなら、閾値に余裕を持たせる');
  lines.push('- **タグ**: 同上。特に `analysis` / `debated` のようにプロトタイプが抽象的な場合、中立スコアが近づきがち');
  lines.push('');

  const outPath = join(ROOT, 'docs/data/llm-benchmark-minilm-sweep.md');
  writeFileSync(outPath, lines.join('\n'));
  console.log(`\n詳細: ${outPath}`);
})().catch(e => { console.error(e); process.exit(1); });
