/**
 * scripts/eval-user-classifier.ts
 *
 * user-labels-gemini.jsonl (ユーザー単位の Gemini ground truth) に対し、
 * Ruri 埋め込み + 線形分類ヘッド → softmax 平均 → cognitive top-1/top-2
 * → determineArchetype で archetype を求め、Gemini primary と比較する。
 *
 * 目的: per-post 分類が noisy でも per-user 集約で accuracy が 80% に
 * 届くかを検証する。
 *
 * 使い方:
 *   pnpm tsx scripts/eval-user-classifier.ts
 *     [--users=PATH] [--classifier=PATH] [--html=PATH]
 */

import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMBEDDING_DTYPE, EMBEDDING_MODEL_ID,
  determineArchetype,
  jobDisplayName,
  type Archetype, type CogFunction, type CognitiveScores,
} from '../packages/core/src/index.js';

env.allowLocalModels = false;
env.useBrowserCache = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni','Ne','Si','Se','Ti','Te','Fi','Fe'];

interface UserLabel {
  handle: string; did: string; posts: string[];
  geminiPrimary: Archetype; geminiRunnerUp: Archetype | null;
  geminiTop3Cog: CogFunction[]; geminiConfidence: string; geminiReasoning: string;
}
interface ClassifierJSON { W: number[][]; b: number[]; classes: string[] }

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  return {
    usersPath: get('users') ?? path.join(repoRoot, 'docs/data/user-labels-gemini.jsonl'),
    classifierPath: get('classifier') ?? path.join(repoRoot, 'docs/data/cognitive-classifier.json'),
    htmlOut: get('html') ?? path.join(repoRoot, 'docs/logs/eval-user-classifier.html'),
  };
}

function softmax(logits: number[]): number[] {
  const mx = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - mx));
  const s = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / s);
}

function predictProbs(vec: Float32Array, cls: ClassifierJSON): number[] {
  const { W, b } = cls;
  const K = b.length, D = vec.length;
  const logits = new Array(K).fill(0);
  for (let j = 0; j < K; j++) {
    let s = b[j]!;
    for (let d = 0; d < D; d++) s += vec[d]! * W[d]![j]!;
    logits[j] = s;
  }
  return softmax(logits);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function main() {
  const { usersPath, classifierPath, htmlOut } = parseArgs();
  console.log(`users: ${usersPath}`);
  console.log(`classifier: ${classifierPath}\n`);

  const raw = (await fs.readFile(usersPath, 'utf-8')).split('\n').filter((l) => l.trim());
  const users: UserLabel[] = raw.map((l) => JSON.parse(l) as UserLabel);
  const cls = JSON.parse(await fs.readFile(classifierPath, 'utf-8')) as ClassifierJSON;
  console.log(`ユーザー: ${users.length} 人、classifier classes: ${cls.classes.join(', ')}\n`);

  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });

  interface EvalRow {
    handle: string; gold: Archetype; pred: Archetype;
    goldTop3Cog: CogFunction[]; predTop3Cog: [CogFunction, CogFunction, CogFunction];
    confidence: string; correct: boolean;
    reasoning: string; postCount: number;
  }
  const rows: EvalRow[] = [];

  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    process.stdout.write(`[${i + 1}/${users.length}] @${u.handle} ... `);
    // 全投稿に対して分類ヘッド → 平均 softmax
    const avgProbs = new Array(cls.classes.length).fill(0);
    for (const text of u.posts) {
      const emb = await extractor(text, { pooling: 'mean', normalize: true });
      const vec = emb.data as Float32Array;
      const probs = predictProbs(vec, cls);
      for (let j = 0; j < avgProbs.length; j++) avgProbs[j]! += probs[j]! / u.posts.length;
    }
    // cognitiveScores 形式にマップ (100 スケール、min-max なしでそのまま softmax を 0-100 に拡大)
    const scores = {} as CognitiveScores;
    for (let j = 0; j < cls.classes.length; j++) scores[cls.classes[j] as CogFunction] = avgProbs[j]! * 100;
    const { archetype: pred, top3 } = determineArchetype(scores);
    const correct = pred === u.geminiPrimary;
    rows.push({
      handle: u.handle, gold: u.geminiPrimary, pred,
      goldTop3Cog: u.geminiTop3Cog, predTop3Cog: top3,
      confidence: u.geminiConfidence, correct,
      reasoning: u.geminiReasoning, postCount: u.posts.length,
    });
    console.log(`${correct ? '✓' : '✗'}  gold=${u.geminiPrimary} pred=${pred}`);
  }

  const correct = rows.filter((r) => r.correct).length;
  const acc = correct / rows.length;
  console.log(`\n=== per-user accuracy: ${correct}/${rows.length} = ${(acc * 100).toFixed(1)}% ===`);

  // 混同行列 (行=Gemini, 列=Ruri)
  const archs = ['sage','mage','shogun','bard','seer','poet','paladin','explorer','warrior','guardian','fighter','artist','captain','miko','ninja','performer'] as Archetype[];
  const conf: Record<Archetype, Record<Archetype, number>> = {} as Record<Archetype, Record<Archetype, number>>;
  for (const r of archs) { conf[r] = {} as Record<Archetype, number>; for (const c of archs) conf[r][c] = 0; }
  for (const row of rows) conf[row.gold]![row.pred]! += 1;

  // HTML
  await fs.mkdir(path.dirname(htmlOut), { recursive: true });
  const rowHtml = rows.map((r) => `
    <tr class="${r.correct ? 'ok' : 'ng'}">
      <td>${r.correct ? '✓' : '✗'}</td>
      <td><a href="https://bsky.app/profile/${esc(r.handle)}" target="_blank">@${esc(r.handle)}</a></td>
      <td>${esc(jobDisplayName(r.gold, 'default'))} <span class="id">(${esc(r.gold)})</span></td>
      <td>${esc(jobDisplayName(r.pred, 'default'))} <span class="id">(${esc(r.pred)})</span></td>
      <td>${esc(r.goldTop3Cog.join(','))}</td>
      <td>${esc(r.predTop3Cog.join(','))}</td>
      <td>${esc(r.confidence)}</td>
      <td class="reason">${esc(r.reasoning.slice(0, 200))}${r.reasoning.length > 200 ? '…' : ''}</td>
    </tr>
  `).join('');

  // 混同行列: 非 0 のセルだけ出す (16x16 は密)
  const pairs: Array<[Archetype, Archetype, number]> = [];
  for (const r of archs) for (const c of archs) {
    const v = conf[r][c];
    if (v > 0) pairs.push([r, c, v]);
  }
  pairs.sort((a, b) => b[2] - a[2]);

  const pairsHtml = pairs.map(([g, p, n]) => {
    const mark = g === p ? '✓' : '';
    return `<tr class="${g === p ? 'ok' : 'ng'}"><td>${mark}</td><td>${esc(jobDisplayName(g, 'default'))} <span class="id">(${esc(g)})</span></td><td>${esc(jobDisplayName(p, 'default'))} <span class="id">(${esc(p)})</span></td><td>${n}</td></tr>`;
  }).join('');

  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>per-user classifier eval</title>
<style>
  body { font-family: "Hiragino Maru Gothic ProN", "Noto Sans JP", sans-serif; margin: 2em; background: #f6f9fc; color: #1c2b44; }
  .summary { background: white; border: 2px solid #9fd7ff; border-radius: 6px; padding: 1em 1.2em; margin: 1em 0; display: flex; gap: 2em; }
  .metric .value { font-size: 2em; font-weight: 700; font-family: ui-monospace, monospace; color: #1c5299; }
  .metric .label { color: #546580; font-size: 0.85em; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 1.5em; overflow: hidden; }
  th, td { padding: 0.5em 0.75em; text-align: left; border-bottom: 1px solid #e0eaf5; font-size: 0.9em; vertical-align: top; }
  th { background: #eef4fb; }
  tr.ok { background: rgba(60, 180, 100, 0.06); }
  tr.ng { background: rgba(220, 100, 100, 0.06); }
  .id { color: #888; font-size: 0.85em; }
  .reason { max-width: 40em; font-size: 0.8em; color: #546580; }
</style></head><body>

<h1>per-user classifier eval</h1>
<p>classifier: ${esc(classifierPath)}</p>

<div class="summary">
  <div class="metric"><div class="value">${(acc * 100).toFixed(1)}%</div><div class="label">per-user accuracy (${correct}/${rows.length})</div></div>
</div>

<h2>archetype ペア集計 (Gemini → Ruri, 出現順)</h2>
<table>
  <thead><tr><th></th><th>Gemini (gold)</th><th>Ruri (pred)</th><th>n</th></tr></thead>
  <tbody>${pairsHtml}</tbody>
</table>

<h2>全ユーザー一覧</h2>
<table>
  <thead><tr><th></th><th>user</th><th>Gemini</th><th>Ruri pred</th><th>Gemini cog top3</th><th>Ruri cog top3</th><th>conf</th><th>Gemini reasoning</th></tr></thead>
  <tbody>${rowHtml}</tbody>
</table>
</body></html>`;
  await fs.writeFile(htmlOut, html, 'utf-8');
  console.log(`HTML: ${htmlOut}`);
}

void main();
