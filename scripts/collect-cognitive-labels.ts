/**
 * scripts/collect-cognitive-labels.ts
 *
 * Gemini 3.1 Flash Lite Preview を教師として、Bluesky 投稿ごとに認知機能を
 * 判定させ、Ruri のプロトタイプ再校正 / 分類ヘッド学習用の train/test set を
 * 構築する。
 *
 * パイプライン:
 *   1. kojira.io のフォロー + ランキング上位からユーザープール構築
 *   2. 各ユーザーから最大 30 投稿取得 (text + createdAt)
 *   3. Gemini に top-3 認知機能 (+ none) を判定させ逐次 JSONL 保存
 *   4. checkpoint ファイルから resume 可
 *
 * 使い方:
 *   pnpm tsx scripts/collect-cognitive-labels.ts [targetCount] [outFile]
 *   デフォルト: 2000 件 / docs/data/cognitive-labeled-gemini.jsonl
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtpAgent } from '@atproto/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview' as const;
const COGNITIVE_FUNCTIONS = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'] as const;
const NONE_LABEL = 'none';
type Label = (typeof COGNITIVE_FUNCTIONS)[number] | typeof NONE_LABEL;

const THROTTLE_MS = 250;
const MAX_RETRIES = 3;
const POSTS_PER_USER = 30;
const MIN_POST_LENGTH = 15;
const RANKING_PAGE_LIMIT = 5; // bluesky-ranking.userlocal.jp のページ数上限

if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: .env に GEMINI_API_KEY を設定してください');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const publicAgent = new AtpAgent({ service: 'https://public.api.bsky.app' });

interface LabeledPost {
  handle: string;
  did: string;
  at: string;
  text: string;
  geminiRanked: Label[]; // top-3
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildPrompt(text: string): string {
  return `以下の Bluesky 投稿を、ユング派の 8 認知機能のうち最も前面に出ているものでランク付けしてください。

認知機能:
- Ni (内向的直観): 本質・未来のビジョン・パターンへの直感
- Ne (外向的直観): 連想、可能性の発散、異分野の接続
- Si (内向的感覚): 記憶・経験・伝統への信頼、積み上げ
- Se (外向的感覚): 今この瞬間、身体性、即時反応、現場対応
- Ti (内向的思考): 内的論理体系、定義、整合性の追求
- Te (外向的思考): 効率・結果・実行・外的秩序化
- Fi (内向的感情): 個人的価値観、真正性、内なる倫理
- Fe (外向的感情): 場の調和、他者の感情への配慮
- none: どの機能も強く出ていない中立的な投稿

投稿: "${text.replace(/"/g, '\\"')}"

上位 3 つをランク付けし、JSON だけを返してください (説明文なし):
{"ranked": ["Ni", "Te", "Fe"]}`;
}

async function classifyWithGemini(text: string): Promise<Label[] | null> {
  const prompt = buildPrompt(text);
  const validLabels = [...COGNITIVE_FUNCTIONS, NONE_LABEL] as const;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { temperature: 0, responseMimeType: 'application/json' },
      });
      const raw = res.text?.trim() ?? '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : raw;
      const parsed = JSON.parse(jsonStr) as { ranked?: string[] };
      const ranked = (parsed.ranked ?? []).filter((s): s is Label => (validLabels as readonly string[]).includes(s));
      if (ranked.length === 0) throw new Error(`invalid labels: ${raw}`);
      return ranked.slice(0, 3);
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
  } catch (e) {
    console.warn(`  fetch failed for @${handle}: ${(e as Error).message}`);
    return [];
  }
}

async function collectFollows(handle: string): Promise<string[]> {
  const out = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    try {
      const res = await publicAgent.app.bsky.graph.getFollows({
        actor: handle, limit: 100, ...(cursor ? { cursor } : {}),
      });
      for (const f of res.data.follows) out.add(f.handle);
      cursor = res.data.cursor;
      if (!cursor) break;
    } catch (e) {
      console.warn(`  follow fetch error: ${(e as Error).message}`);
      break;
    }
  }
  return [...out];
}

async function collectRankingHandles(): Promise<string[]> {
  const out = new Set<string>();
  for (let page = 1; page <= RANKING_PAGE_LIMIT; page++) {
    try {
      const html = await fetch(`https://bluesky-ranking.userlocal.jp/?page=${page}`).then((r) => r.text());
      const anchorRe = /<a class="position-absolute[^"]*" href="\/u\/([a-z0-9_]+)">[^<]+<\/a>/g;
      const userMatches = [...html.matchAll(anchorRe)];
      for (const m of userMatches) {
        const anonId = m[1]!;
        try {
          const userPage = await fetch(`https://bluesky-ranking.userlocal.jp/u/${anonId}`).then((r) => r.text());
          const handleMatch = userPage.match(/bsky\.app\/profile\/([a-zA-Z0-9._-]+\.[a-zA-Z.]+)/);
          if (handleMatch) out.add(handleMatch[1]!);
        } catch { /* noop */ }
      }
    } catch (e) {
      console.warn(`  ranking page ${page} failed: ${(e as Error).message}`);
    }
  }
  return [...out];
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
    try {
      const entry = JSON.parse(line) as LabeledPost;
      keys.add(`${entry.did}:${entry.at}`);
    } catch { /* noop */ }
  }
  return keys;
}

async function main() {
  const targetCount = Number(process.argv[2] ?? '2000');
  const outFile = process.argv[3] ?? path.join(repoRoot, 'docs/data/cognitive-labeled-gemini.jsonl');

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const existing = loadExisting(outFile);
  console.log(`[resume] 既存ラベル付け ${existing.size} 件、目標 ${targetCount} 件`);

  console.log(`\n[1/3] ユーザープール構築`);
  console.log(`  kojira.io のフォロー取得中...`);
  const follows = await collectFollows('kojira.io');
  console.log(`    ${follows.length} 人`);
  console.log(`  bluesky-ranking 上位取得中...`);
  const ranking = await collectRankingHandles();
  console.log(`    ${ranking.length} 人`);
  const allHandles = shuffle([...new Set([...follows, ...ranking])]);
  console.log(`  合計 ${allHandles.length} ユニークユーザー`);

  console.log(`\n[2/3] 投稿プール構築 (最大 ${POSTS_PER_USER} 件/人)`);
  const postsPool: Array<{ handle: string; did: string; at: string; text: string }> = [];
  for (let i = 0; i < allHandles.length; i++) {
    if (postsPool.length >= targetCount * 1.5) break; // 余裕を見て 1.5x 集める
    const handle = allHandles[i]!;
    const posts = await fetchPosts(handle, POSTS_PER_USER);
    for (const p of posts) {
      if (!existing.has(`${p.did}:${p.at}`)) {
        postsPool.push({ handle, did: p.did, at: p.at, text: p.text });
      }
    }
    if ((i + 1) % 20 === 0) process.stdout.write(`    ${i + 1}/${allHandles.length} (pool=${postsPool.length})\n`);
  }
  // dedupe by (did, at)
  const deduped = new Map<string, typeof postsPool[0]>();
  for (const p of postsPool) deduped.set(`${p.did}:${p.at}`, p);
  const sampled = shuffle([...deduped.values()]).slice(0, targetCount - existing.size);
  console.log(`  候補 ${deduped.size} 件、新規サンプリング ${sampled.length} 件`);

  console.log(`\n[3/3] Gemini 判定 (${GEMINI_MODEL})`);
  let classified = 0;
  let classifiedNone = 0;
  let failed = 0;
  const t0 = performance.now();
  for (let i = 0; i < sampled.length; i++) {
    const p = sampled[i]!;
    const ranked = await classifyWithGemini(p.text);
    if (!ranked) {
      failed++;
    } else {
      const entry: LabeledPost = {
        handle: p.handle, did: p.did, at: p.at, text: p.text, geminiRanked: ranked,
      };
      appendFileSync(outFile, JSON.stringify(entry) + '\n', 'utf-8');
      classified++;
      if (ranked[0] === NONE_LABEL) classifiedNone++;
    }
    if ((i + 1) % 25 === 0) {
      const elapsed = (performance.now() - t0) / 1000;
      const rate = (i + 1) / elapsed;
      const eta = (sampled.length - i - 1) / rate;
      process.stdout.write(
        `    ${i + 1}/${sampled.length}  ok=${classified} none=${classifiedNone} fail=${failed}  ${rate.toFixed(1)}req/s  ETA ${Math.round(eta)}s\n`,
      );
    }
    await sleep(THROTTLE_MS);
  }

  const total = existing.size + classified;
  console.log(`\n完了: 合計 ${total} 件 (none: ${classifiedNone}, fail: ${failed})`);
  console.log(`出力: ${outFile}`);
}

void main();
