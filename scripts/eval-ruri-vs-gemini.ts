/**
 * scripts/eval-ruri-vs-gemini.ts
 *
 * Gemini ラベル付き test set に対して Ruri の per-post cognitive top-1
 * 判定を実行し、一致率 / 混同行列 / per-class precision & recall を出す。
 *
 * モード:
 *   --prototypes=original  (default): apps/web/public/prototypes/cognitive/*.bin を使う
 *   --prototypes=<dir>:             任意ディレクトリの *.bin を使う (Gemini 学習後の
 *                                   プロトタイプを指定するためのもの)
 *
 * 使い方:
 *   pnpm tsx scripts/eval-ruri-vs-gemini.ts [--test=PATH] [--prototypes=DIR]
 */

import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIAGNOSIS_TOP_N,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL_ID,
  cosineSimilarity,
  topNAverage,
  type CogFunction,
} from '../packages/core/src/index.js';

env.allowLocalModels = false;
env.useBrowserCache = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

interface LabeledPost { handle: string; did: string; at: string; text: string; geminiRanked: string[] }

function parseArgs(): { testPath: string; protoDir: string; htmlOut: string | null } {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const proto = get('prototypes');
  return {
    testPath: get('test') ?? path.join(repoRoot, 'docs/data/cognitive-split/test.jsonl'),
    protoDir: !proto || proto === 'original'
      ? path.join(repoRoot, 'apps/web/public/prototypes/cognitive')
      : path.resolve(proto),
    htmlOut: get('html') ?? path.join(repoRoot, 'eval-ruri-vs-gemini.html'),
  };
}

async function unpackBinFile(file: string): Promise<Float32Array[]> {
  const buf = await fs.readFile(file);
  const n = buf.readInt32LE(0);
  const d = buf.readInt32LE(4);
  if (d !== EMBEDDING_DIMENSIONS) throw new Error(`dim mismatch in ${file}: ${d} != ${EMBEDDING_DIMENSIONS}`);
  const vecs: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(d);
    for (let k = 0; k < d; k++) v[k] = buf.readFloatLE(8 + (i * d + k) * 4);
    vecs.push(v);
  }
  return vecs;
}

async function loadPrototypes(dir: string): Promise<Record<CogFunction, Float32Array[]>> {
  const out = {} as Record<CogFunction, Float32Array[]>;
  for (const fn of COGNITIVE_FUNCTIONS) out[fn] = await unpackBinFile(path.join(dir, `${fn}.bin`));
  return out;
}

function classifyPost(
  vec: Float32Array,
  protos: Record<CogFunction, Float32Array[]>,
): { top1: CogFunction; scores: Record<CogFunction, number> } {
  const scores = {} as Record<CogFunction, number>;
  for (const fn of COGNITIVE_FUNCTIONS) {
    scores[fn] = topNAverage(vec, protos[fn], DIAGNOSIS_TOP_N);
  }
  // Per-post 中心化 (diagnose() と同じ)
  const mean = COGNITIVE_FUNCTIONS.reduce((a, fn) => a + scores[fn], 0) / COGNITIVE_FUNCTIONS.length;
  const centered = {} as Record<CogFunction, number>;
  for (const fn of COGNITIVE_FUNCTIONS) centered[fn] = scores[fn] - mean;
  // argmax
  let top1: CogFunction = 'Ni';
  let best = -Infinity;
  for (const fn of COGNITIVE_FUNCTIONS) {
    if (centered[fn] > best) { best = centered[fn]; top1 = fn; }
  }
  return { top1, scores: centered };
}

async function main() {
  const { testPath, protoDir, htmlOut } = parseArgs();
  console.log(`test set: ${testPath}`);
  console.log(`prototypes: ${protoDir}`);
  console.log(`html out: ${htmlOut}\n`);

  const raw = (await fs.readFile(testPath, 'utf-8')).split('\n').filter((l) => l.trim());
  const entries: LabeledPost[] = raw.map((l) => JSON.parse(l) as LabeledPost);
  console.log(`test 件数: ${entries.length}\n`);

  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });
  const protos = await loadPrototypes(protoDir);
  console.log(`prototypes 件数/機能:`);
  for (const fn of COGNITIVE_FUNCTIONS) console.log(`  ${fn}: ${protos[fn].length}`);

  // 評価
  let correct = 0;
  let correctTop3 = 0;
  const confusion: Record<string, Record<string, number>> = {};
  for (const fn of COGNITIVE_FUNCTIONS) {
    confusion[fn] = {};
    for (const gn of COGNITIVE_FUNCTIONS) confusion[fn][gn] = 0;
  }
  interface EvalEntry { handle: string; text: string; gold: string; geminiTop3: string[]; ruriTop1: CogFunction; correct: boolean }
  const evalEntries: EvalEntry[] = [];

  process.stdout.write(`\n評価中... `);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const emb = await extractor(e.text, { pooling: 'mean', normalize: true });
    const vec = emb.data as Float32Array;
    const { top1 } = classifyPost(vec, protos);
    const gold = e.geminiRanked[0]!;
    const isCorrect = top1 === gold;
    if (isCorrect) correct++;
    if (e.geminiRanked.slice(0, 3).includes(top1)) correctTop3++;
    if (gold in confusion) confusion[gold][top1]! += 1;
    evalEntries.push({ handle: e.handle, text: e.text, gold, geminiTop3: e.geminiRanked.slice(0, 3), ruriTop1: top1, correct: isCorrect });
    if ((i + 1) % 50 === 0) process.stdout.write(`${i + 1} `);
  }
  console.log('done\n');

  const acc = correct / entries.length;
  const accTop3 = correctTop3 / entries.length;
  console.log(`=== サマリー ===`);
  console.log(`  Ruri top-1 == Gemini top-1: ${correct}/${entries.length} = ${(acc * 100).toFixed(1)}%`);
  console.log(`  Ruri top-1 ∈ Gemini top-3:  ${correctTop3}/${entries.length} = ${(accTop3 * 100).toFixed(1)}%`);

  console.log(`\n=== 混同行列 (行=Gemini top-1 / 列=Ruri top-1) ===`);
  const header = '     ' + COGNITIVE_FUNCTIONS.map((f) => f.padStart(5)).join(' ');
  console.log(header);
  for (const row of COGNITIVE_FUNCTIONS) {
    const cells = COGNITIVE_FUNCTIONS.map((col) => {
      const v = confusion[row]![col]!;
      return String(v).padStart(5);
    }).join(' ');
    console.log(`${row}   ${cells}`);
  }

  console.log(`\n=== per-class precision & recall ===`);
  const perClass: Array<{ fn: CogFunction; p: number; r: number; f1: number; support: number }> = [];
  for (const fn of COGNITIVE_FUNCTIONS) {
    const rowSum = COGNITIVE_FUNCTIONS.reduce((s, c) => s + confusion[fn]![c]!, 0);
    const colSum = COGNITIVE_FUNCTIONS.reduce((s, r) => s + confusion[r]![fn]!, 0);
    const tp = confusion[fn]![fn]!;
    const recall = rowSum > 0 ? tp / rowSum : 0;
    const precision = colSum > 0 ? tp / colSum : 0;
    const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
    console.log(`  ${fn}  P=${(precision * 100).toFixed(1)}%  R=${(recall * 100).toFixed(1)}%  F1=${(f1 * 100).toFixed(1)}  (支持=${rowSum})`);
    perClass.push({ fn, p: precision, r: recall, f1, support: rowSum });
  }

  // HTML レポート出力
  if (htmlOut) {
    await writeHtmlReport(htmlOut, {
      testPath, protoDir, total: entries.length, correct, correctTop3,
      confusion, perClass, evalEntries,
    });
    console.log(`\nHTML: ${htmlOut}`);
  }

  void cosineSimilarity;
}

interface HtmlPayload {
  testPath: string;
  protoDir: string;
  total: number;
  correct: number;
  correctTop3: number;
  confusion: Record<string, Record<string, number>>;
  perClass: Array<{ fn: CogFunction; p: number; r: number; f1: number; support: number }>;
  evalEntries: Array<{ handle: string; text: string; gold: string; geminiTop3: string[]; ruriTop1: CogFunction; correct: boolean }>;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function writeHtmlReport(out: string, p: HtmlPayload): Promise<void> {
  const acc = p.correct / p.total;
  const accTop3 = p.correctTop3 / p.total;

  // 混同行列の最大値 (ヒートマップ用)
  let cellMax = 0;
  for (const row of COGNITIVE_FUNCTIONS) for (const col of COGNITIVE_FUNCTIONS) cellMax = Math.max(cellMax, p.confusion[row]![col]!);

  const confHtml = `
    <table class="confusion">
      <thead>
        <tr><th></th>${COGNITIVE_FUNCTIONS.map((c) => `<th>${c}</th>`).join('')}<th>支持</th></tr>
      </thead>
      <tbody>
        ${COGNITIVE_FUNCTIONS.map((row) => {
          const rowSum = COGNITIVE_FUNCTIONS.reduce((s, c) => s + p.confusion[row]![c]!, 0);
          return `<tr>
            <th>${row}</th>
            ${COGNITIVE_FUNCTIONS.map((col) => {
              const v = p.confusion[row]![col]!;
              const intensity = cellMax > 0 ? v / cellMax : 0;
              const diag = row === col;
              const bg = diag
                ? `rgba(60, 180, 100, ${0.15 + intensity * 0.65})`
                : `rgba(220, 100, 100, ${intensity * 0.6})`;
              return `<td style="background: ${bg};">${v}</td>`;
            }).join('')}
            <td class="sup">${rowSum}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  const perClassHtml = `
    <table class="perclass">
      <thead><tr><th>機能</th><th>Precision</th><th>Recall</th><th>F1</th><th>支持</th></tr></thead>
      <tbody>
        ${p.perClass.map((c) => `<tr>
          <th>${c.fn}</th>
          <td><div class="bar" style="--v:${c.p * 100}%"><span>${(c.p * 100).toFixed(1)}%</span></div></td>
          <td><div class="bar" style="--v:${c.r * 100}%"><span>${(c.r * 100).toFixed(1)}%</span></div></td>
          <td><div class="bar f1" style="--v:${c.f1 * 100}%"><span>${(c.f1 * 100).toFixed(1)}</span></div></td>
          <td>${c.support}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  // 誤分類サンプルを各 gold-ruri ペアで最大 5 件ずつ抽出
  const missGroups: Record<string, HtmlPayload['evalEntries']> = {};
  for (const e of p.evalEntries) {
    if (e.correct) continue;
    const key = `${e.gold}_${e.ruriTop1}`;
    (missGroups[key] ??= []).push(e);
  }
  const missSections = Object.entries(missGroups)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .map(([key, items]) => {
      const [gold, ruri] = key.split('_');
      const examples = items.slice(0, 5).map((e) => `
        <li>
          <div class="post">${esc(e.text.length > 200 ? e.text.slice(0, 200) + '…' : e.text)}</div>
          <div class="meta">@${esc(e.handle)}  Gemini=[${esc(e.geminiTop3.join(','))}]</div>
        </li>`).join('');
      return `
        <details>
          <summary>Gemini <b>${gold}</b> → Ruri <b>${ruri}</b>  (${items.length} 件)</summary>
          <ol>${examples}</ol>
        </details>`;
    }).join('');

  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<title>Ruri vs Gemini cognitive classification</title>
<style>
  body { font-family: "Hiragino Maru Gothic ProN", "Noto Sans JP", sans-serif; margin: 2em; background: #f6f9fc; color: #1c2b44; }
  h1, h2 { margin: 0 0 0.4em; }
  .meta { color: #546580; font-size: 0.9em; margin-bottom: 1.5em; }
  .summary { background: white; border: 2px solid #9fd7ff; border-radius: 6px; padding: 1em 1.2em; margin-bottom: 1em; display: flex; gap: 2em; flex-wrap: wrap; }
  .metric { }
  .metric .value { font-size: 2.2em; font-weight: 700; font-family: ui-monospace, monospace; color: #1c5299; }
  .metric .label { color: #546580; font-size: 0.85em; }
  table { border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 1em; }
  .confusion th, .confusion td { padding: 0.5em 0.75em; text-align: center; border: 1px solid #e0eaf5; font-family: ui-monospace, monospace; min-width: 3em; }
  .confusion th { background: #eef4fb; font-weight: 700; }
  .confusion .sup { background: #f8fafd; color: #546580; }
  .perclass th, .perclass td { padding: 0.5em 0.75em; border-bottom: 1px solid #e0eaf5; text-align: left; font-family: ui-monospace, monospace; }
  .perclass th { background: #eef4fb; font-weight: 700; }
  .bar { position: relative; background: #e0eaf5; border-radius: 3px; overflow: hidden; height: 1.4em; width: 8em; }
  .bar::before { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--v); background: linear-gradient(90deg, #60a5fa, #3b82f6); }
  .bar.f1::before { background: linear-gradient(90deg, #34d399, #10b981); }
  .bar span { position: relative; z-index: 1; padding: 0 0.6em; font-size: 0.85em; color: #1c2b44; line-height: 1.4em; }
  details { background: white; border: 1px solid #e0eaf5; border-radius: 4px; padding: 0.5em 0.8em; margin-bottom: 0.4em; }
  details summary { cursor: pointer; font-family: ui-monospace, monospace; }
  details ol { padding-left: 1.2em; }
  details .post { background: #f8fafd; padding: 0.5em; border-radius: 3px; margin: 0.4em 0; white-space: pre-wrap; font-size: 0.9em; }
  details .meta { font-size: 0.75em; color: #546580; }
</style>
</head><body>
<h1>Ruri vs Gemini cognitive classification</h1>
<div class="meta">
  test set: ${esc(p.testPath)}<br>
  prototypes: ${esc(p.protoDir)}<br>
  生成: ${new Date().toLocaleString('ja-JP')}
</div>

<div class="summary">
  <div class="metric"><div class="value">${(acc * 100).toFixed(1)}%</div><div class="label">top-1 accuracy (${p.correct}/${p.total})</div></div>
  <div class="metric"><div class="value">${(accTop3 * 100).toFixed(1)}%</div><div class="label">Ruri top-1 ∈ Gemini top-3</div></div>
  <div class="metric"><div class="value">${p.total}</div><div class="label">test 件数</div></div>
</div>

<h2>混同行列 (行=Gemini top-1, 列=Ruri top-1)</h2>
${confHtml}

<h2>per-class precision / recall / F1</h2>
${perClassHtml}

<h2>誤分類サンプル (gold → ruri ペア上位 15)</h2>
${missSections}

</body></html>`;
  await fs.writeFile(out, html, 'utf-8');
}

void main();
