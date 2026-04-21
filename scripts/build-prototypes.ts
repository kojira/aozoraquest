/**
 * 認知機能プロトタイプの埋め込みを事前計算。
 *
 * packages/prompts/cognitive/*.json を読み、
 * Ruri-v3-30m-ONNX で各プロトタイプ文を埋め込み、
 * apps/web/public/prototypes/cognitive/*.bin に保存する。
 *
 * ランタイムで 150 投稿 × 1 回 + プロトタイプ 160 文の計 310 回/初回 から、
 * 150 回に削減 (プロトタイプは事前埋め込み済みを bin 読込)。
 *
 * 使い方: pnpm build:prototypes
 *
 * bin レイアウト:
 *   int32 LE : プロトタイプ数 N
 *   int32 LE : 次元数 D
 *   float32[N*D] LE : 行ごとに 1 プロトタイプベクトル
 */

import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDING_DIMENSIONS, EMBEDDING_DTYPE, EMBEDDING_MODEL_ID } from '../packages/core/src/embedding-config.js';

env.allowLocalModels = false;
env.useBrowserCache = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(repoRoot, 'packages/prompts/cognitive');
const OUTPUT_DIR = path.join(repoRoot, 'apps/web/public/prototypes/cognitive');

interface PrototypeJson {
  function: string;
  description?: string;
  prototypes: Array<{ text: string }>;
}

async function embedText(extractor: any, text: string): Promise<Float32Array> {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return out.data as Float32Array;
}

function packBin(vectors: Float32Array[], dims: number): Buffer {
  const n = vectors.length;
  const buf = Buffer.alloc(8 + n * dims * 4);
  buf.writeInt32LE(n, 0);
  buf.writeInt32LE(dims, 4);
  let offset = 8;
  for (const v of vectors) {
    if (v.length !== dims) throw new Error(`dim mismatch: expected ${dims}, got ${v.length}`);
    for (let i = 0; i < dims; i++) {
      buf.writeFloatLE(v[i]!, offset);
      offset += 4;
    }
  }
  return buf;
}

async function main() {
  console.log(`loading ${EMBEDDING_MODEL_ID} (${EMBEDDING_DTYPE})...`);
  const extractor: any = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });
  console.log('model ready');

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const inputs = (await fs.readdir(INPUT_DIR)).filter((f) => f.endsWith('.json'));
  if (inputs.length === 0) throw new Error(`no JSON in ${INPUT_DIR}`);

  let totalVectors = 0;
  for (const file of inputs) {
    const srcPath = path.join(INPUT_DIR, file);
    const json = JSON.parse(await fs.readFile(srcPath, 'utf8')) as PrototypeJson;
    const texts = json.prototypes.map((p) => p.text);
    const fnName = json.function || path.basename(file, '.json');
    process.stdout.write(`  ${fnName}: embedding ${texts.length} prototypes...`);
    const t0 = Date.now();
    const vecs: Float32Array[] = [];
    for (const t of texts) vecs.push(await embedText(extractor, t));
    const bin = packBin(vecs, EMBEDDING_DIMENSIONS);
    const outPath = path.join(OUTPUT_DIR, `${fnName}.bin`);
    await fs.writeFile(outPath, bin);
    totalVectors += vecs.length;
    console.log(` ok (${((Date.now() - t0) / 1000).toFixed(1)}s → ${bin.length} bytes)`);
  }

  console.log(`\ndone. ${inputs.length} files, ${totalVectors} vectors, ${EMBEDDING_DIMENSIONS} dims, ${EMBEDDING_DTYPE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
