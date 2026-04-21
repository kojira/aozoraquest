/**
 * 認知機能 + 行動タイプ プロトタイプの埋め込みを事前計算。
 *
 * - packages/prompts/cognitive/*.json → apps/web/public/prototypes/cognitive/*.bin (診断用)
 * - packages/prompts/actions/*.json   → apps/web/public/prototypes/actions/*.bin   (投稿直後の行動分類用)
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

interface PrototypeJson {
  function?: string;
  action?: string;
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

async function processDir(
  extractor: any,
  inputDir: string,
  outputDir: string,
  keyField: 'function' | 'action',
): Promise<{ files: number; vectors: number }> {
  await fs.mkdir(outputDir, { recursive: true });
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(inputDir)).filter((f) => f.endsWith('.json'));
  } catch {
    console.log(`  (${inputDir} なし — スキップ)`);
    return { files: 0, vectors: 0 };
  }
  if (entries.length === 0) {
    console.log(`  (${inputDir} 空 — スキップ)`);
    return { files: 0, vectors: 0 };
  }
  let totalVectors = 0;
  for (const file of entries) {
    const srcPath = path.join(inputDir, file);
    const json = JSON.parse(await fs.readFile(srcPath, 'utf8')) as PrototypeJson;
    const texts = json.prototypes.map((p) => p.text);
    const name = (json[keyField] as string | undefined) || path.basename(file, '.json');
    process.stdout.write(`  ${name}: embedding ${texts.length} prototypes...`);
    const t0 = Date.now();
    const vecs: Float32Array[] = [];
    for (const t of texts) vecs.push(await embedText(extractor, t));
    const bin = packBin(vecs, EMBEDDING_DIMENSIONS);
    const outPath = path.join(outputDir, `${name}.bin`);
    await fs.writeFile(outPath, bin);
    totalVectors += vecs.length;
    console.log(` ok (${((Date.now() - t0) / 1000).toFixed(1)}s → ${bin.length} bytes)`);
  }
  return { files: entries.length, vectors: totalVectors };
}

async function main() {
  console.log(`loading ${EMBEDDING_MODEL_ID} (${EMBEDDING_DTYPE})...`);
  const extractor: any = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });
  console.log('model ready\n');

  console.log('[cognitive]');
  const cog = await processDir(
    extractor,
    path.join(repoRoot, 'packages/prompts/cognitive'),
    path.join(repoRoot, 'apps/web/public/prototypes/cognitive'),
    'function',
  );

  console.log('\n[actions]');
  const act = await processDir(
    extractor,
    path.join(repoRoot, 'packages/prompts/actions'),
    path.join(repoRoot, 'apps/web/public/prototypes/actions'),
    'action',
  );

  console.log(
    `\ndone. cognitive: ${cog.files} files / ${cog.vectors} vectors. actions: ${act.files} files / ${act.vectors} vectors. ${EMBEDDING_DIMENSIONS} dims, ${EMBEDDING_DTYPE}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
