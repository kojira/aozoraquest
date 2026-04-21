/**
 * 1 人だけ診断して、8 機能の正規化スコア全部 + 各 archetype の fit スコア詳細を
 * ダンプする。忍者が過剰判定される原因を数値ベースで調べるための内省用スクリプト。
 *
 * 使い方: pnpm tsx scripts/inspect-one.ts <handle>
 */

import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtpAgent } from '@atproto/api';
import {
  ARCHETYPE_FIT_WEIGHTS,
  DIAGNOSIS_MIN_POST_COUNT,
  DIAGNOSIS_POST_LIMIT,
  DIAGNOSIS_TOP_N,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL_ID,
  JOBS,
  computePostWeights,
  cosineSimilarity,
  diagnose,
  jobDisplayName,
  type CogFunction,
} from '../packages/core/src/index.js';

env.allowLocalModels = false;
env.useBrowserCache = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PROTO_DIR = path.join(repoRoot, 'apps/web/public/prototypes/cognitive');
const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

const OPPOSITE_LETTER: Record<string, string> = { N: 'S', S: 'N', T: 'F', F: 'T' };
const OPPOSITE_ATTITUDE: Record<string, string> = { i: 'e', e: 'i' };

function temperamentStack(dom: CogFunction, aux: CogFunction) {
  const tertiary = (OPPOSITE_LETTER[aux[0]!]! + dom[1]!) as CogFunction;
  const inferior = (OPPOSITE_LETTER[dom[0]!]! + OPPOSITE_ATTITUDE[dom[1]!]!) as CogFunction;
  return { tertiary, inferior };
}

async function unpackBinFile(file: string): Promise<Float32Array[]> {
  const buf = await fs.readFile(file);
  const n = buf.readInt32LE(0);
  const d = buf.readInt32LE(4);
  if (d !== EMBEDDING_DIMENSIONS) throw new Error(`dim mismatch`);
  const vecs: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(d);
    for (let k = 0; k < d; k++) v[k] = buf.readFloatLE(8 + (i * d + k) * 4);
    vecs.push(v);
  }
  return vecs;
}

async function main() {
  const handle = process.argv[2];
  if (!handle) { console.error('usage: pnpm tsx scripts/inspect-one.ts <handle>'); process.exit(1); }

  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });
  const protos: Record<CogFunction, Float32Array[]> = {} as any;
  for (const fn of COGNITIVE_FUNCTIONS) protos[fn] = await unpackBinFile(path.join(PROTO_DIR, `${fn}.bin`));

  const agent = new AtpAgent({ service: 'https://public.api.bsky.app' });
  const posts: { text: string; at: string }[] = [];
  let cursor: string | undefined;
  while (posts.length < DIAGNOSIS_POST_LIMIT) {
    const res = await agent.app.bsky.feed.getAuthorFeed({
      actor: handle, limit: Math.min(100, DIAGNOSIS_POST_LIMIT - posts.length),
      ...(cursor ? { cursor } : {}), filter: 'posts_no_replies',
    });
    for (const item of res.data.feed) {
      const rec = item.post.record as { text?: string; createdAt?: string };
      if (typeof rec.text === 'string' && rec.text.length >= 10) {
        posts.push({ text: rec.text, at: rec.createdAt ?? item.post.indexedAt ?? new Date().toISOString() });
      }
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  if (posts.length < DIAGNOSIS_MIN_POST_COUNT) {
    console.error(`insufficient posts (${posts.length})`); process.exit(1);
  }
  console.log(`@${handle}: ${posts.length} posts`);

  const vecs: Float32Array[] = [];
  for (const p of posts) {
    const emb = await extractor(p.text, { pooling: 'mean', normalize: true });
    vecs.push(emb.data as Float32Array);
  }
  // ── 診断内部の生値を再計算して表示 (diagnose() のブラックボックスを開く) ──
  console.log('\n=== 生の per-post top-N 平均スコア分布 ===');
  const topN = DIAGNOSIS_TOP_N;
  const weights = computePostWeights(posts.map((p) => p.at), new Date());
  // 各投稿で 8 機能の raw top-N 平均を取り、「per-post 平均を引く」ところまでしか
  // 正規化していない生値を集計する
  const rawAgg = Object.fromEntries(COGNITIVE_FUNCTIONS.map((f) => [f, 0])) as Record<CogFunction, number>;
  const centeredAgg = Object.fromEntries(COGNITIVE_FUNCTIONS.map((f) => [f, 0])) as Record<CogFunction, number>;
  let totalWeight = 0;
  // 各投稿単位の per-function score の分布を把握するため、全投稿の値を保存
  const perFnValues: Record<CogFunction, number[]> = Object.fromEntries(
    COGNITIVE_FUNCTIONS.map((f) => [f, [] as number[]]),
  ) as Record<CogFunction, number[]>;
  for (let i = 0; i < vecs.length; i++) {
    const vec = vecs[i]!;
    const w = weights[i] ?? 1;
    totalWeight += w;
    const perFn: Record<CogFunction, number> = {} as any;
    let mean = 0;
    for (const fn of COGNITIVE_FUNCTIONS) {
      const sims = protos[fn].map((p) => cosineSimilarity(vec, p)).sort((a, b) => b - a).slice(0, topN);
      const s = sims.reduce((a, b) => a + b, 0) / sims.length;
      perFn[fn] = s;
      perFnValues[fn].push(s);
      mean += s;
      rawAgg[fn] += s * w;
    }
    mean /= COGNITIVE_FUNCTIONS.length;
    for (const fn of COGNITIVE_FUNCTIONS) {
      centeredAgg[fn] += (perFn[fn] - mean) * w;
    }
  }
  for (const fn of COGNITIVE_FUNCTIONS) {
    rawAgg[fn] /= totalWeight;
    centeredAgg[fn] /= totalWeight;
  }

  console.log(`  per-post cosine ${topN} 平均の機能別中央値 & 分布:`);
  const cogSorted = COGNITIVE_FUNCTIONS.slice().sort((a, b) => rawAgg[b] - rawAgg[a]);
  for (const fn of cogSorted) {
    const vals = perFnValues[fn].slice().sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)]!;
    const p10 = vals[Math.floor(vals.length * 0.1)]!;
    const p90 = vals[Math.floor(vals.length * 0.9)]!;
    console.log(
      `    ${fn}  raw_avg=${rawAgg[fn].toFixed(4)}  median=${median.toFixed(4)}  p10=${p10.toFixed(4)}  p90=${p90.toFixed(4)}`,
    );
  }

  console.log('\n=== 中心化 (per-post 平均引き算) 後の集約値 ===');
  const ceSorted = COGNITIVE_FUNCTIONS.slice().sort((a, b) => centeredAgg[b] - centeredAgg[a]);
  const ceMin = Math.min(...COGNITIVE_FUNCTIONS.map((f) => centeredAgg[f]));
  const ceMax = Math.max(...COGNITIVE_FUNCTIONS.map((f) => centeredAgg[f]));
  const ceRange = ceMax - ceMin;
  for (const fn of ceSorted) {
    console.log(`    ${fn}  centered=${centeredAgg[fn].toFixed(5)}`);
  }
  console.log(`  範囲 (max - min) = ${ceRange.toFixed(5)}  [これが min-max 正規化で 100 に展開される絶対幅]`);

  const r = diagnose(vecs, protos, posts.length, new Date(), { timestamps: posts.map((p) => p.at) });
  if ('insufficient' in r) { console.error('insufficient'); process.exit(1); }

  console.log('\n=== Cognitive scores (min-max 後、0-100) ===');
  const sortedScores = (Object.entries(r.cognitiveScores) as [CogFunction, number][])
    .sort((a, b) => b[1] - a[1]);
  for (const [fn, s] of sortedScores) {
    console.log(`  ${fn}: ${String(s).padStart(3)}`);
  }

  console.log('\n=== Archetype fit (sorted by fit score) ===');
  const w = ARCHETYPE_FIT_WEIGHTS;
  const fits = JOBS.map((j) => {
    const { tertiary, inferior } = temperamentStack(j.dominantFunction, j.auxiliaryFunction);
    const fit =
      w.dom * r.cognitiveScores[j.dominantFunction] +
      w.aux * r.cognitiveScores[j.auxiliaryFunction] +
      w.tertiary * r.cognitiveScores[tertiary] +
      w.inferior * r.cognitiveScores[inferior];
    return {
      archetype: j.id,
      name: jobDisplayName(j.id, 'default'),
      dom: j.dominantFunction, aux: j.auxiliaryFunction, tertiary, inferior,
      domScore: r.cognitiveScores[j.dominantFunction],
      auxScore: r.cognitiveScores[j.auxiliaryFunction],
      tertScore: r.cognitiveScores[tertiary],
      infScore: r.cognitiveScores[inferior],
      fit,
    };
  }).sort((a, b) => b.fit - a.fit);
  for (const f of fits) {
    console.log(
      `  ${String(Math.round(f.fit)).padStart(3)}  ${f.name.padEnd(5, '　')}  ${f.archetype.padEnd(10)}` +
      `  dom=${f.dom}:${String(f.domScore).padStart(3)}` +
      `  aux=${f.aux}:${String(f.auxScore).padStart(3)}` +
      `  tert=${f.tertiary}:${String(f.tertScore).padStart(3)}` +
      `  inf=${f.inferior}:${String(f.infScore).padStart(3)}`,
    );
  }

  console.log(`\n=> 採用 archetype: ${r.archetype} (${jobDisplayName(r.archetype, 'default')}), confidence: ${r.confidence}`);
}

void main();
