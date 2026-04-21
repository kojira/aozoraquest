/**
 * Bluesky 人気ランキング (bluesky-ranking.userlocal.jp) の上位ユーザーを
 * AozoraQuest の診断パイプラインにかけ、archetype の分布を確認する。
 *
 * 目的: 「全員が賢者になる」系のバイアスが修正されているかを本番相当の
 * 入力で確認する。
 *
 * 使い方:
 *   pnpm tsx scripts/diagnose-ranking.ts [count]  # count=10 default
 */

import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtpAgent } from '@atproto/api';
import {
  DIAGNOSIS_MIN_POST_COUNT,
  DIAGNOSIS_POST_LIMIT,
  DIAGNOSIS_TOP_N,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL_ID,
  diagnose,
  jobDisplayName,
  type CogFunction,
} from '../packages/core/src/index.js';

env.allowLocalModels = false;
env.useBrowserCache = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PROTO_DIR = path.join(repoRoot, 'apps/web/public/prototypes/cognitive');
const RANKING_URL = 'https://bluesky-ranking.userlocal.jp/';
const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

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

async function loadPrototypes(): Promise<Record<CogFunction, Float32Array[]>> {
  const out = {} as Record<CogFunction, Float32Array[]>;
  for (const fn of COGNITIVE_FUNCTIONS) {
    out[fn] = await unpackBinFile(path.join(PROTO_DIR, `${fn}.bin`));
  }
  return out;
}

async function scrapeRanking(limit: number): Promise<Array<{ displayName: string; handle: string }>> {
  const pages = Math.ceil(limit / 20);
  const out: Array<{ displayName: string; handle: string }> = [];
  for (let page = 1; page <= pages && out.length < limit; page++) {
    const html = await fetch(`${RANKING_URL}?page=${page}`).then((r) => r.text());
    // /u/xxxx のアンカー + display name を抽出、続いて /u/xxxx の詳細ページから handle を取る
    const anchors = [...html.matchAll(/<a class="position-absolute[^"]*" href="\/u\/([a-z0-9_]+)">([^<]+)<\/a>/g)];
    for (const m of anchors) {
      if (out.length >= limit) break;
      const anonId = m[1]!;
      const displayName = m[2]!.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      const userPage = await fetch(`${RANKING_URL}u/${anonId}`).then((r) => r.text());
      const handleMatch = userPage.match(/bsky\.app\/profile\/([a-zA-Z0-9._-]+\.[a-zA-Z.]+)/);
      if (handleMatch) {
        out.push({ displayName, handle: handleMatch[1]! });
      }
    }
  }
  return out;
}

async function fetchUserPosts(actor: string, limit: number = DIAGNOSIS_POST_LIMIT): Promise<{ text: string; at: string }[]> {
  const agent = new AtpAgent({ service: 'https://public.api.bsky.app' });
  const out: { text: string; at: string }[] = [];
  let cursor: string | undefined;
  while (out.length < limit) {
    const res = await agent.app.bsky.feed.getAuthorFeed({
      actor,
      limit: Math.min(100, limit - out.length),
      ...(cursor ? { cursor } : {}),
      filter: 'posts_no_replies',
    });
    for (const item of res.data.feed) {
      const rec = item.post.record as { text?: string; createdAt?: string };
      if (typeof rec.text === 'string' && rec.text.length >= 10) {
        out.push({ text: rec.text, at: rec.createdAt ?? item.post.indexedAt ?? new Date().toISOString() });
      }
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return out.slice(0, limit);
}

async function main() {
  const count = Number(process.argv[2] ?? 10);
  console.log(`Loading ${EMBEDDING_MODEL_ID} ...`);
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });
  const protos = await loadPrototypes();
  console.log(`Prototypes loaded. Top-N = ${DIAGNOSIS_TOP_N}`);
  console.log(`Scraping top ${count} users from ${RANKING_URL} ...`);
  const users = await scrapeRanking(count);
  console.log(`Got ${users.length} users.`);

  const archetypeDist = new Map<string, number>();
  const rows: string[] = [];
  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    process.stdout.write(`[${i + 1}/${users.length}] ${u.displayName} (@${u.handle}) ... `);
    try {
      const posts = await fetchUserPosts(u.handle, DIAGNOSIS_POST_LIMIT);
      if (posts.length < DIAGNOSIS_MIN_POST_COUNT) {
        console.log(`skip (only ${posts.length} posts)`);
        continue;
      }
      const vecs: Float32Array[] = [];
      for (const p of posts) {
        const emb = await extractor(p.text, { pooling: 'mean', normalize: true });
        vecs.push(emb.data as Float32Array);
      }
      const result = diagnose(vecs, protos, posts.length, new Date(), { timestamps: posts.map((p) => p.at) });
      if ('insufficient' in result) {
        console.log(`insufficient (${result.postCount})`);
        continue;
      }
      const jp = jobDisplayName(result.archetype, 'default');
      archetypeDist.set(jp, (archetypeDist.get(jp) ?? 0) + 1);
      // top-3 cognitive
      const top3 = (Object.entries(result.cognitiveScores) as [CogFunction, number][])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      const row = `${jp}\t${result.archetype}\t${top3}\t${result.confidence}\t${u.displayName}\t@${u.handle}`;
      console.log(`${jp} [${top3}] (${result.confidence})`);
      rows.push(row);
    } catch (e) {
      console.log(`error: ${(e as Error).message}`);
    }
  }

  console.log('\n========== archetype 分布 ==========');
  const sorted = [...archetypeDist.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) console.log(`${String(v).padStart(3)}  ${k}`);
  console.log('\n========== 詳細 ==========');
  console.log('job\tarchetype\ttop3_cognitive\tconfidence\tname\thandle');
  for (const r of rows) console.log(r);
}

void main();
