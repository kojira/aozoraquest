/**
 * scripts/build-balanced-split.ts
 *
 * collect-cognitive-labels.ts が生成した raw JSONL を読み、
 * Gemini top-1 label ごとに class-balanced な train/test split を作る。
 *
 * 目的: 自然分布だと Se / Ne / Fe に偏るので、希少クラス (Ti, Fi, Si 等)
 *       が少ないまま学習すると分類器もそこを学べない。各クラス同数
 *       に揃えて、過剰クラスをダウンサンプル。希少クラスが下限を
 *       下回っていれば、どれくらい足りないかだけ警告して続行する。
 *
 * 使い方:
 *   pnpm tsx scripts/build-balanced-split.ts [--in=PATH] [--out-dir=DIR]
 *                                            [--per-class=200] [--test-ratio=0.2]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const COGNITIVE_FUNCTIONS = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'] as const;

interface LabeledPost {
  handle: string;
  did: string;
  at: string;
  text: string;
  geminiRanked: string[]; // top-3 including possibly "none"
}

function parseArgs(): { inPath: string; outDir: string; perClass: number; testRatio: number } {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    inPath: get('in') ?? path.join(repoRoot, 'docs/data/cognitive-labeled-gemini.jsonl'),
    outDir: get('out-dir') ?? path.join(repoRoot, 'docs/data/cognitive-split'),
    perClass: Number(get('per-class') ?? '200'),
    testRatio: Number(get('test-ratio') ?? '0.2'),
  };
}

function shuffle<T>(arr: T[], seed = 0): T[] {
  // 決定的シャッフル (再現性)
  const a = [...arr];
  let s = seed || 42;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function main() {
  const { inPath, outDir, perClass, testRatio } = parseArgs();
  await fs.mkdir(outDir, { recursive: true });

  const raw = (await fs.readFile(inPath, 'utf-8')).split('\n').filter((l) => l.trim());
  const entries: LabeledPost[] = [];
  for (const line of raw) {
    try {
      const obj = JSON.parse(line) as LabeledPost;
      if (Array.isArray(obj.geminiRanked) && obj.geminiRanked.length > 0) entries.push(obj);
    } catch { /* skip malformed */ }
  }
  console.log(`読み込み: ${entries.length} 件 (${inPath})`);

  // top-1 = 'none' は学習データから除外
  const usable = entries.filter((e) => e.geminiRanked[0] !== 'none');
  console.log(`  'none' top-1 を除外: ${usable.length} 件`);

  // top-1 ごとにグルーピング
  const byClass: Record<string, LabeledPost[]> = {};
  for (const fn of COGNITIVE_FUNCTIONS) byClass[fn] = [];
  for (const e of usable) {
    const top1 = e.geminiRanked[0]!;
    if (top1 in byClass) byClass[top1]!.push(e);
  }

  console.log(`\n自然分布 (top-1):`);
  for (const fn of COGNITIVE_FUNCTIONS) {
    const n = byClass[fn]!.length;
    const bar = '█'.repeat(Math.round(n / 5));
    console.log(`  ${fn}  ${String(n).padStart(4)}  ${bar}`);
  }

  // 各クラスから perClass 件サンプリング (足りなければその数で)
  const allTrain: LabeledPost[] = [];
  const allTest: LabeledPost[] = [];
  console.log(`\nクラス別サンプリング (目標 ${perClass} 件/クラス、test ${Math.round(testRatio * 100)}%):`);
  for (const fn of COGNITIVE_FUNCTIONS) {
    const bucket = shuffle(byClass[fn]!, fn.charCodeAt(0) + fn.charCodeAt(1));
    const take = Math.min(perClass, bucket.length);
    const testN = Math.round(take * testRatio);
    const trainN = take - testN;
    const trainPart = bucket.slice(0, trainN);
    const testPart = bucket.slice(trainN, trainN + testN);
    allTrain.push(...trainPart);
    allTest.push(...testPart);
    const short = bucket.length < perClass ? ` (不足 ${perClass - bucket.length})` : '';
    console.log(`  ${fn}  train=${trainN}  test=${testN}${short}`);
  }

  const trainPath = path.join(outDir, 'train.jsonl');
  const testPath = path.join(outDir, 'test.jsonl');
  await fs.writeFile(trainPath, shuffle(allTrain, 777).map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
  await fs.writeFile(testPath, shuffle(allTest, 888).map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');

  console.log(`\n書き込み:`);
  console.log(`  ${trainPath}  (${allTrain.length} 件)`);
  console.log(`  ${testPath}  (${allTest.length} 件)`);
}

void main();
