/**
 * 1 人のユーザーを Ruri と Gemini で並行診断して結果を比較する。
 *
 * 目的: Ruri の argmax 判定 (例: 忍者) が妥当なのか、それともノイズ増幅に
 *       よる誤判定なのかを、より強いモデル (Gemini 3.1 Flash Lite) の
 *       ゼロショット推論と比較して検証する。
 *
 * 使い方: pnpm tsx scripts/compare-gemini-one.ts <handle>
 */

import 'dotenv/config';
import { pipeline, env } from '@huggingface/transformers';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtpAgent } from '@atproto/api';
import {
  ARCHETYPE_FIT_WEIGHTS,
  ARCHETYPES,
  DIAGNOSIS_MIN_POST_COUNT,
  DIAGNOSIS_POST_LIMIT,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL_ID,
  JOBS,
  JOBS_BY_ID,
  diagnose,
  jobDisplayName,
  jobTagline,
  type Archetype,
  type CogFunction,
} from '../packages/core/src/index.js';

env.allowLocalModels = false;
env.useBrowserCache = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PROTO_DIR = path.join(repoRoot, 'apps/web/public/prototypes/cognitive');
const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview' as const;
const GEMINI_SAMPLE_POSTS = 50;

if (!process.env.GEMINI_API_KEY) {
  console.error('エラー: .env に GEMINI_API_KEY を設定してください');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function unpackBinFile(file: string): Promise<Float32Array[]> {
  const buf = await fs.readFile(file);
  const n = buf.readInt32LE(0);
  const d = buf.readInt32LE(4);
  if (d !== EMBEDDING_DIMENSIONS) throw new Error('dim mismatch');
  const vecs: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(d);
    for (let k = 0; k < d; k++) v[k] = buf.readFloatLE(8 + (i * d + k) * 4);
    vecs.push(v);
  }
  return vecs;
}

function buildGeminiPrompt(posts: string[]): string {
  const archetypeCatalog = JOBS.map((j) => {
    const name = jobDisplayName(j.id, 'default');
    const tag = jobTagline(j.id);
    return `- ${j.id} (${name}): dom=${j.dominantFunction}, aux=${j.auxiliaryFunction} — ${tag}`;
  }).join('\n');

  const postsJoined = posts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, ' ').slice(0, 200)}`).join('\n');

  return `あなたは気質診断の専門家です。Bluesky ユーザーの投稿群から、そのユーザーに最も合う 16 archetype のうち 1 つを判定してください。

## 16 archetype 一覧 (dom = 主機能、aux = 補助機能)

${archetypeCatalog}

## ユング派 8 認知機能の短い定義

- Ni (内向的直観): 本質・未来のビジョン・パターンへの直感
- Ne (外向的直観): 連想、可能性の発散、異分野の接続
- Si (内向的感覚): 記憶・経験・伝統への信頼、積み上げ
- Se (外向的感覚): 今この瞬間、身体性、即時反応、現場対応
- Ti (内向的思考): 内的論理体系、定義、整合性の追求
- Te (外向的思考): 効率・結果・実行・外的秩序化
- Fi (内向的感情): 個人的価値観、真正性、内なる倫理
- Fe (外向的感情): 場の調和、他者の感情への配慮

## 対象ユーザーの投稿 (${posts.length} 件)

${postsJoined}

## あなたの出力

以下の JSON だけを返してください (説明文やコードブロック無し):

{
  "primary": "<archetype id>",
  "runner_up": "<archetype id>",
  "top3_cognitive": ["<fn1>", "<fn2>", "<fn3>"],
  "confidence": "<high | medium | low>",
  "reasoning": "<日本語 200-400 字。なぜこの archetype か、どの投稿や傾向が根拠か。>"
}`;
}

interface GeminiResult {
  primary: string;
  runner_up: string;
  top3_cognitive: string[];
  confidence: string;
  reasoning: string;
}

async function classifyWithGemini(posts: string[]): Promise<GeminiResult> {
  const prompt = buildGeminiPrompt(posts);
  const res = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { temperature: 0, responseMimeType: 'application/json' },
  });
  const text = res.text?.trim() ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : text;
  const parsed = JSON.parse(jsonStr) as GeminiResult;
  return parsed;
}

async function main() {
  const handle = process.argv[2] ?? 'chi-bird.com';

  console.log(`=== 比較対象: @${handle} ===\n`);

  // ── Step 1: 投稿取得 ──
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
    console.error(`posts insufficient (${posts.length})`); process.exit(1);
  }
  console.log(`投稿 ${posts.length} 件取得`);

  // ── Step 2: Ruri 診断 (既存パイプライン) ──
  console.log('\n--- Ruri 診断 (CPU int8) ---');
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });
  const protos: Record<CogFunction, Float32Array[]> = {} as Record<CogFunction, Float32Array[]>;
  for (const fn of COGNITIVE_FUNCTIONS) protos[fn] = await unpackBinFile(path.join(PROTO_DIR, `${fn}.bin`));

  const vecs: Float32Array[] = [];
  for (const p of posts) {
    const emb = await extractor(p.text, { pooling: 'mean', normalize: true });
    vecs.push(emb.data as Float32Array);
  }
  const ruri = diagnose(vecs, protos, posts.length, new Date(), { timestamps: posts.map((p) => p.at) });
  if ('insufficient' in ruri) { console.error('ruri insufficient'); process.exit(1); }

  const ruriTop3 = (Object.entries(ruri.cognitiveScores) as [CogFunction, number][])
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' ');
  const w = ARCHETYPE_FIT_WEIGHTS;
  const OPP_LETTER: Record<string, string> = { N: 'S', S: 'N', T: 'F', F: 'T' };
  const OPP_ATT: Record<string, string> = { i: 'e', e: 'i' };
  const fits = JOBS.map((j) => {
    const tertiary = (OPP_LETTER[j.auxiliaryFunction[0]!]! + j.dominantFunction[1]!) as CogFunction;
    const inferior = (OPP_LETTER[j.dominantFunction[0]!]! + OPP_ATT[j.dominantFunction[1]!]!) as CogFunction;
    const fit =
      w.dom * ruri.cognitiveScores[j.dominantFunction] +
      w.aux * ruri.cognitiveScores[j.auxiliaryFunction] +
      w.tertiary * ruri.cognitiveScores[tertiary] +
      w.inferior * ruri.cognitiveScores[inferior];
    return { id: j.id, fit };
  }).sort((a, b) => b.fit - a.fit);

  console.log(`  archetype: ${ruri.archetype} (${jobDisplayName(ruri.archetype, 'default')})`);
  console.log(`  runner-up: ${fits[1]!.id} (${jobDisplayName(fits[1]!.id, 'default')}) fit=${fits[1]!.fit.toFixed(1)} (top fit=${fits[0]!.fit.toFixed(1)})`);
  console.log(`  confidence: ${ruri.confidence}`);
  console.log(`  cognitive top-3: ${ruriTop3}`);

  // ── Step 3: Gemini 判定 ──
  console.log(`\n--- Gemini 判定 (${GEMINI_MODEL}) ---`);
  // Gemini には投稿をサンプル (直近 50 件) 送る
  const samplePosts = posts.slice(0, GEMINI_SAMPLE_POSTS).map((p) => p.text);
  console.log(`  ${samplePosts.length} 件の投稿を送信中...`);
  const gemini = await classifyWithGemini(samplePosts);
  console.log(`  archetype: ${gemini.primary} (${gemini.primary in JOBS_BY_ID ? jobDisplayName(gemini.primary as Archetype, 'default') : '?'})`);
  console.log(`  runner-up: ${gemini.runner_up} (${gemini.runner_up in JOBS_BY_ID ? jobDisplayName(gemini.runner_up as Archetype, 'default') : '?'})`);
  console.log(`  confidence: ${gemini.confidence}`);
  console.log(`  cognitive top-3: ${gemini.top3_cognitive.join(' ')}`);
  console.log(`  reasoning:\n    ${gemini.reasoning.replace(/\n/g, '\n    ')}`);

  // ── Step 4: 比較 ──
  console.log('\n=== 比較サマリー ===');
  const primaryMatch = ruri.archetype === gemini.primary;
  console.log(`  archetype 一致: ${primaryMatch ? '✓' : '✗'}  (Ruri=${ruri.archetype} / Gemini=${gemini.primary})`);
  const ruriCogTop1 = ruriTop3.split(' ')[0]!.split(':')[0]!;
  const geminiCogTop1 = gemini.top3_cognitive[0];
  console.log(`  cognitive top-1 一致: ${ruriCogTop1 === geminiCogTop1 ? '✓' : '✗'}  (Ruri=${ruriCogTop1} / Gemini=${geminiCogTop1})`);

  // Ruri top-3 と Gemini top-3 の overlap
  const ruriSet = new Set(ruriTop3.split(' ').map((s) => s.split(':')[0]));
  const geminiSet = new Set(gemini.top3_cognitive);
  const overlap = [...ruriSet].filter((f) => geminiSet.has(f!));
  console.log(`  cognitive top-3 重複: ${overlap.length}/3  (${overlap.join(',')})`);

  // ユーザーが合致しなかった場合の補助情報
  if (!primaryMatch && gemini.primary in JOBS_BY_ID) {
    const geminiArch = JOBS_BY_ID[gemini.primary as Archetype];
    const ruriArch = JOBS_BY_ID[ruri.archetype];
    console.log(`\n  参考: Gemini 推奨 (${gemini.primary}) の dom=${geminiArch.dominantFunction}, aux=${geminiArch.auxiliaryFunction}`);
    console.log(`        Ruri 採用 (${ruri.archetype}) の dom=${ruriArch.dominantFunction}, aux=${ruriArch.auxiliaryFunction}`);
    const geminiFit = fits.find((f) => f.id === gemini.primary);
    if (geminiFit) {
      console.log(`        Gemini 推奨 archetype の Ruri fit ランク: ${fits.findIndex((f) => f.id === gemini.primary) + 1} 位 (fit=${geminiFit.fit.toFixed(1)})`);
    }
  }

  // ARCHETYPES 列挙を明示 (未知の primary への保険)
  void ARCHETYPES;
}

void main();
