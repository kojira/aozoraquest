/**
 * scripts/build-centroid-prototypes.ts
 *
 * train.jsonl (Gemini top-1 ラベル付き) から、認知機能ごとに新しい
 * プロトタイプベクトル群を生成する。既存の手書きプロトタイプを
 * "データドリブン centroid" で置き換えるためのもの。
 *
 * 出力: 既存と同じレイアウト (int32 N + int32 D + float32[N*D]) で .bin を
 *       書き出す。1 機能あたり K 件 (train の先頭 K 件) を代表プロトタイプ
 *       として採用。これにより既存の loadPrototypeEmbeddings が無修正で
 *       使える。
 *
 * 使い方:
 *   pnpm tsx scripts/build-centroid-prototypes.ts [--train=PATH] [--out-dir=DIR] [--k=25]
 */

import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL_ID,
  type CogFunction,
} from '../packages/core/src/index.js';

env.allowLocalModels = false;
env.useBrowserCache = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

interface LabeledPost { text: string; geminiRanked: string[] }

function parseArgs(): { trainPath: string; outDir: string; k: number } {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    trainPath: get('train') ?? path.join(repoRoot, 'docs/data/cognitive-split/train.jsonl'),
    outDir: get('out-dir') ?? path.join(repoRoot, 'apps/web/public/prototypes/cognitive-centroid'),
    k: Number(get('k') ?? '25'),
  };
}

function packBin(vecs: Float32Array[], dims: number): Buffer {
  const n = vecs.length;
  const buf = Buffer.alloc(8 + n * dims * 4);
  buf.writeInt32LE(n, 0);
  buf.writeInt32LE(dims, 4);
  let off = 8;
  for (const v of vecs) {
    if (v.length !== dims) throw new Error(`dim mismatch ${v.length} != ${dims}`);
    for (let i = 0; i < dims; i++) { buf.writeFloatLE(v[i]!, off); off += 4; }
  }
  return buf;
}

async function main() {
  const { trainPath, outDir, k } = parseArgs();
  await fs.mkdir(outDir, { recursive: true });

  const raw = (await fs.readFile(trainPath, 'utf-8')).split('\n').filter((l) => l.trim());
  const entries: LabeledPost[] = raw.map((l) => JSON.parse(l) as LabeledPost);
  console.log(`train 件数: ${entries.length}`);

  // クラス別に分ける (Gemini top-1 で)
  const byClass: Record<CogFunction, LabeledPost[]> = {} as Record<CogFunction, LabeledPost[]>;
  for (const fn of COGNITIVE_FUNCTIONS) byClass[fn] = [];
  for (const e of entries) {
    const t1 = e.geminiRanked[0]!;
    if (t1 in byClass) byClass[t1 as CogFunction].push(e);
  }
  console.log(`\nクラス別件数:`);
  for (const fn of COGNITIVE_FUNCTIONS) console.log(`  ${fn}: ${byClass[fn].length}`);

  console.log(`\nRuri (${EMBEDDING_MODEL_ID}) を読み込み中 (CPU int8)...`);
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });

  console.log(`\n各機能の先頭 ${k} 件を埋め込み → centroid プロトタイプとして書き出し\n`);
  for (const fn of COGNITIVE_FUNCTIONS) {
    const pick = byClass[fn].slice(0, k);
    if (pick.length === 0) {
      console.warn(`  ${fn}: 0 件 (skip)`);
      continue;
    }
    const vecs: Float32Array[] = [];
    for (const e of pick) {
      const emb = await extractor(e.text, { pooling: 'mean', normalize: true });
      vecs.push(emb.data as Float32Array);
    }
    const outFile = path.join(outDir, `${fn}.bin`);
    await fs.writeFile(outFile, packBin(vecs, EMBEDDING_DIMENSIONS));
    console.log(`  ${fn}: ${vecs.length} vec → ${outFile}`);
  }
  console.log(`\n完了。eval-ruri-vs-gemini.ts --prototypes=${outDir} で accuracy 比較してください。`);
}

void main();
