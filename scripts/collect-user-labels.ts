/**
 * scripts/collect-user-labels.ts
 *
 * ユーザー単位の ground truth を Gemini で構築する。kojira.io のフォロー +
 * ランキング上位から対象をサンプリングし、各ユーザーの投稿 30 件を一括で
 * Gemini に渡して 16 archetype のどれに合うかを判定させる。
 *
 * Phase G (per-user Ruri 推論) の評価セットとして使う。
 *
 * 使い方:
 *   pnpm tsx scripts/collect-user-labels.ts [targetUsers] [outFile]
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtpAgent } from '@atproto/api';
import {
  ARCHETYPES,
  JOBS,
  jobDisplayName,
  jobTagline,
  type Archetype,
  type CogFunction,
} from '../packages/core/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview' as const;
const POSTS_PER_USER = 30;
const MIN_POST_LENGTH = 15;
const THROTTLE_MS = 500;

if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: .env に GEMINI_API_KEY を設定してください');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const publicAgent = new AtpAgent({ service: 'https://public.api.bsky.app' });

interface UserLabel {
  handle: string;
  did: string;
  posts: string[];          // このユーザー分 classifier に通す投稿
  geminiPrimary: Archetype; // Gemini top-1 archetype
  geminiRunnerUp: Archetype | null;
  geminiTop3Cog: CogFunction[];
  geminiConfidence: string;
  geminiReasoning: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildUserPrompt(posts: string[]): string {
  const cat = JOBS.map((j) => {
    const name = jobDisplayName(j.id, 'default');
    const tag = jobTagline(j.id);
    return `- ${j.id} (${name}): dom=${j.dominantFunction}, aux=${j.auxiliaryFunction} — ${tag}`;
  }).join('\n');
  const postsJoined = posts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, ' ').slice(0, 200)}`).join('\n');
  return `あなたは気質診断の専門家です。Bluesky ユーザーの投稿群から、そのユーザーに最も合う 16 archetype のうち 1 つを判定してください。

## 16 archetype
${cat}

## 認知機能の定義 (参考)
- Ni/Ne: 本質/連想
- Si/Se: 記憶/今この瞬間
- Ti/Te: 整合性/結果
- Fi/Fe: 個人価値観/場の調和

## 投稿 (${posts.length} 件)
${postsJoined}

## 出力 (JSON のみ、説明文コードブロック無し)
{
  "primary": "<archetype id>",
  "runner_up": "<archetype id>",
  "top3_cognitive": ["<fn1>", "<fn2>", "<fn3>"],
  "confidence": "<high | medium | low>",
  "reasoning": "<日本語 200-400 字。根拠となる投稿や傾向。>"
}`;
}

async function classifyUser(posts: string[]): Promise<Omit<UserLabel, 'handle' | 'did' | 'posts'> | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: buildUserPrompt(posts),
        config: { temperature: 0, responseMimeType: 'application/json' },
      });
      const raw = res.text?.trim() ?? '';
      const m = raw.match(/\{[\s\S]*\}/);
      const js = m ? m[0] : raw;
      const parsed = JSON.parse(js) as {
        primary?: string; runner_up?: string; top3_cognitive?: string[];
        confidence?: string; reasoning?: string;
      };
      const primary = parsed.primary;
      if (!primary || !(ARCHETYPES as readonly string[]).includes(primary)) {
        throw new Error(`invalid primary: ${primary}`);
      }
      const ru = parsed.runner_up && (ARCHETYPES as readonly string[]).includes(parsed.runner_up)
        ? (parsed.runner_up as Archetype) : null;
      const top3 = Array.isArray(parsed.top3_cognitive)
        ? parsed.top3_cognitive.filter((s): s is CogFunction => ['Ni','Ne','Si','Se','Ti','Te','Fi','Fe'].includes(s))
        : [];
      return {
        geminiPrimary: primary as Archetype,
        geminiRunnerUp: ru,
        geminiTop3Cog: top3,
        geminiConfidence: parsed.confidence ?? '',
        geminiReasoning: parsed.reasoning ?? '',
      };
    } catch (e) {
      lastError = e;
      await sleep(500 * (attempt + 1));
    }
  }
  console.warn('  gemini failed:', (lastError as Error)?.message);
  return null;
}

async function fetchPosts(handle: string, limit: number): Promise<Array<{ at: string; text: string; did: string }>> {
  try {
    const res = await publicAgent.app.bsky.feed.getAuthorFeed({
      actor: handle, limit, filter: 'posts_no_replies',
    });
    const out: Array<{ at: string; text: string; did: string }> = [];
    for (const item of res.data.feed) {
      const rec = item.post.record as { text?: string; createdAt?: string };
      if (typeof rec.text === 'string' && rec.text.length >= MIN_POST_LENGTH) {
        out.push({
          at: rec.createdAt ?? item.post.indexedAt ?? new Date().toISOString(),
          text: rec.text,
          did: item.post.author.did,
        });
      }
    }
    return out;
  } catch { return []; }
}

async function collectFollows(handle: string): Promise<Array<{ handle: string; did: string }>> {
  const out = new Map<string, string>();
  let cursor: string | undefined;
  while (true) {
    try {
      const res = await publicAgent.app.bsky.graph.getFollows({
        actor: handle, limit: 100, ...(cursor ? { cursor } : {}),
      });
      for (const f of res.data.follows) out.set(f.did, f.handle);
      cursor = res.data.cursor;
      if (!cursor) break;
    } catch { break; }
  }
  return [...out.entries()].map(([did, h]) => ({ handle: h, did }));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function loadExisting(file: string): Set<string> {
  if (!existsSync(file)) return new Set();
  const lines = require('node:fs').readFileSync(file, 'utf-8').split('\n').filter((l: string) => l.trim());
  const keys = new Set<string>();
  for (const line of lines) {
    try { const e = JSON.parse(line) as UserLabel; keys.add(e.did); } catch { /* noop */ }
  }
  return keys;
}

async function main() {
  const target = Number(process.argv[2] ?? '80');
  const outFile = process.argv[3] ?? path.join(repoRoot, 'docs/data/user-labels-gemini.jsonl');
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const existing = loadExisting(outFile);
  console.log(`[resume] 既存 ${existing.size} 人、目標 ${target} 人`);

  console.log('\nユーザープール構築...');
  const follows = await collectFollows('kojira.io');
  console.log(`  kojira.io フォロー ${follows.length} 人`);
  const pool = shuffle(follows).filter((u) => !existing.has(u.did));
  console.log(`  未ラベル ${pool.length} 人`);

  let done = existing.size;
  let idx = 0;
  while (done < target && idx < pool.length) {
    const u = pool[idx]!;
    idx++;
    process.stdout.write(`[${done + 1}/${target}] @${u.handle} ... `);
    const posts = await fetchPosts(u.handle, POSTS_PER_USER);
    if (posts.length < 20) { console.log(`skip (only ${posts.length} posts)`); continue; }
    const texts = posts.slice(0, POSTS_PER_USER).map((p) => p.text);
    const r = await classifyUser(texts);
    if (!r) { console.log('gemini failed'); continue; }
    const entry: UserLabel = {
      handle: u.handle,
      did: u.did,
      posts: texts,
      ...r,
    };
    appendFileSync(outFile, JSON.stringify(entry) + '\n', 'utf-8');
    done++;
    console.log(`${r.geminiPrimary} (${jobDisplayName(r.geminiPrimary, 'default')}) [${r.geminiConfidence}]`);
    await sleep(THROTTLE_MS);
  }

  console.log(`\n完了: ${done} 人 → ${outFile}`);
}

void main();
