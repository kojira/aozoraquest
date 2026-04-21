/**
 * scripts/train-classifier-head.ts
 *
 * Ruri 埋め込み (256d) を固定、256→8 の線形 softmax 分類ヘッドを
 * Gemini ラベルで教師学習する。パラメータ 2056 個と極少なので
 * SGD + L2 で 100 iter 程度で収束する。
 *
 * 出力: JSON { W: number[256][8], b: number[8], classes: string[] }
 *       既存のプロトタイプ方式とは独立に、eval-ruri-vs-gemini.ts から
 *       --classifier=<path> で参照する。
 *
 * 使い方:
 *   pnpm tsx scripts/train-classifier-head.ts [--train=PATH] [--out=PATH]
 *     [--epochs=200] [--lr=0.5] [--l2=0.0005]
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

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  return {
    trainPath: get('train') ?? path.join(repoRoot, 'docs/data/cognitive-split/train.jsonl'),
    testPath:  get('test')  ?? path.join(repoRoot, 'docs/data/cognitive-split/test.jsonl'),
    outPath:   get('out')   ?? path.join(repoRoot, 'docs/data/cognitive-classifier.json'),
    epochs:    Number(get('epochs') ?? '200'),
    lr:        Number(get('lr') ?? '0.5'),
    l2:        Number(get('l2') ?? '0.0005'),
  };
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function argmax(arr: number[]): number {
  let idx = 0, best = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i]! > best) { best = arr[i]!; idx = i; }
  return idx;
}

async function embedAll(texts: string[]): Promise<Float32Array[]> {
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    const emb = await extractor(texts[i]!, { pooling: 'mean', normalize: true });
    out.push(emb.data as Float32Array);
    if ((i + 1) % 100 === 0) process.stdout.write(`  ${i + 1}/${texts.length}\n`);
  }
  return out;
}

/**
 * 線形 softmax 分類を全バッチ SGD で学習。
 * 損失: 平均 cross-entropy + (l2/2) * ||W||^2
 * 勾配: dW = X^T (P - Y) / N + l2 * W;  db = mean(P - Y)
 */
function train(
  X: Float32Array[], y: number[], nClasses: number, epochs: number, lr: number, l2: number,
): { W: number[][]; b: number[]; trainLoss: number; trainAcc: number } {
  const D = X[0]!.length;
  const N = X.length;
  // Xavier 初期化
  const scale = Math.sqrt(2 / D);
  const W: number[][] = Array.from({ length: D }, () =>
    Array.from({ length: nClasses }, () => (Math.random() - 0.5) * 2 * scale),
  );
  const b: number[] = new Array(nClasses).fill(0);

  // クラス別重み: class_weight[j] = N / (nClasses * count[j])
  // 少数派クラスの loss を重く、多数派を軽くする。imbalanced set 用の
  // sklearn 互換 "balanced" 式。
  const classCount: number[] = new Array(nClasses).fill(0);
  for (const yi of y) classCount[yi]++;
  const classWeight: number[] = classCount.map((c) => c > 0 ? N / (nClasses * c) : 0);
  console.log(`  class weights:`);
  for (let j = 0; j < nClasses; j++) {
    console.log(`    class ${j}  n=${classCount[j]}  weight=${classWeight[j]!.toFixed(3)}`);
  }

  let lastLoss = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    let loss = 0;
    let weightedCount = 0;
    let correct = 0;
    const gradW: number[][] = Array.from({ length: D }, () => new Array(nClasses).fill(0));
    const gradB: number[] = new Array(nClasses).fill(0);
    for (let i = 0; i < N; i++) {
      const x = X[i]!;
      const yi = y[i]!;
      const w = classWeight[yi]!;
      const logits: number[] = new Array(nClasses).fill(0);
      for (let j = 0; j < nClasses; j++) {
        let s = b[j]!;
        for (let d = 0; d < D; d++) s += x[d]! * W[d]![j]!;
        logits[j] = s;
      }
      const probs = softmax(logits);
      loss += -w * Math.log(Math.max(1e-12, probs[yi]!));
      weightedCount += w;
      if (argmax(probs) === yi) correct++;
      // dL/dlogit_j = w * (probs[j] - 1(j=yi))
      for (let j = 0; j < nClasses; j++) {
        const diff = w * (probs[j]! - (j === yi ? 1 : 0));
        gradB[j] += diff;
        for (let d = 0; d < D; d++) gradW[d]![j]! += x[d]! * diff;
      }
    }
    // L2 正則化 + mean (weighted)
    for (let d = 0; d < D; d++) for (let j = 0; j < nClasses; j++) {
      gradW[d]![j] = gradW[d]![j]! / N + l2 * W[d]![j]!;
    }
    for (let j = 0; j < nClasses; j++) gradB[j] = gradB[j]! / N;
    // 更新
    for (let d = 0; d < D; d++) for (let j = 0; j < nClasses; j++) W[d]![j]! -= lr * gradW[d]![j]!;
    for (let j = 0; j < nClasses; j++) b[j]! -= lr * gradB[j]!;

    lastLoss = loss / weightedCount;
    if (epoch % 20 === 0 || epoch === epochs - 1) {
      console.log(`  epoch ${String(epoch).padStart(3)}  loss=${lastLoss.toFixed(4)}  train_acc=${((correct / N) * 100).toFixed(1)}%`);
    }
  }
  return { W, b, trainLoss: lastLoss, trainAcc: 0 };
}

function predict(x: Float32Array, W: number[][], b: number[]): number[] {
  const nClasses = b.length;
  const D = x.length;
  const logits: number[] = new Array(nClasses).fill(0);
  for (let j = 0; j < nClasses; j++) {
    let s = b[j]!;
    for (let d = 0; d < D; d++) s += x[d]! * W[d]![j]!;
    logits[j] = s;
  }
  return softmax(logits);
}

async function main() {
  const opts = parseArgs();
  console.log(`train: ${opts.trainPath}`);
  console.log(`test:  ${opts.testPath}`);
  console.log(`out:   ${opts.outPath}`);
  console.log(`epochs=${opts.epochs}  lr=${opts.lr}  l2=${opts.l2}\n`);

  const trainRaw = (await fs.readFile(opts.trainPath, 'utf-8')).split('\n').filter((l) => l.trim());
  const testRaw = (await fs.readFile(opts.testPath, 'utf-8')).split('\n').filter((l) => l.trim());
  const trainEntries = trainRaw.map((l) => JSON.parse(l) as LabeledPost);
  const testEntries  = testRaw.map((l) => JSON.parse(l) as LabeledPost);
  console.log(`train: ${trainEntries.length} 件、test: ${testEntries.length} 件`);

  const labelIdx = new Map<string, number>();
  COGNITIVE_FUNCTIONS.forEach((fn, i) => labelIdx.set(fn, i));

  console.log(`\n[1/3] train 埋め込み中 (CPU int8)...`);
  const trainX = await embedAll(trainEntries.map((e) => e.text));
  const trainY = trainEntries.map((e) => labelIdx.get(e.geminiRanked[0]!) ?? -1);
  if (trainY.some((y) => y < 0)) throw new Error('unknown label in train set');

  console.log(`\n[2/3] 線形分類器を SGD で学習中 (params=${EMBEDDING_DIMENSIONS * COGNITIVE_FUNCTIONS.length + COGNITIVE_FUNCTIONS.length})`);
  const { W, b } = train(trainX, trainY, COGNITIVE_FUNCTIONS.length, opts.epochs, opts.lr, opts.l2);

  console.log(`\n[3/3] test 評価`);
  const testX = await embedAll(testEntries.map((e) => e.text));
  let correct = 0;
  let correctTop3 = 0;
  const confusion: Record<string, Record<string, number>> = {};
  for (const fn of COGNITIVE_FUNCTIONS) {
    confusion[fn] = {};
    for (const gn of COGNITIVE_FUNCTIONS) confusion[fn][gn] = 0;
  }
  for (let i = 0; i < testX.length; i++) {
    const probs = predict(testX[i]!, W, b);
    const topIdx = argmax(probs);
    const topFn = COGNITIVE_FUNCTIONS[topIdx]!;
    const gold = testEntries[i]!.geminiRanked[0]!;
    if (topFn === gold) correct++;
    if (testEntries[i]!.geminiRanked.slice(0, 3).includes(topFn)) correctTop3++;
    if (gold in confusion) confusion[gold]![topFn]! += 1;
  }
  console.log(`  top-1 acc: ${correct}/${testX.length} = ${((correct / testX.length) * 100).toFixed(1)}%`);
  console.log(`  top-1 ∈ Gemini top-3: ${correctTop3}/${testX.length} = ${((correctTop3 / testX.length) * 100).toFixed(1)}%`);

  console.log(`\n=== 混同行列 ===`);
  console.log('     ' + COGNITIVE_FUNCTIONS.map((f) => f.padStart(5)).join(' '));
  for (const row of COGNITIVE_FUNCTIONS) {
    const cells = COGNITIVE_FUNCTIONS.map((col) => String(confusion[row]![col]!).padStart(5)).join(' ');
    console.log(`${row}   ${cells}`);
  }

  await fs.writeFile(opts.outPath, JSON.stringify({ W, b, classes: COGNITIVE_FUNCTIONS, meta: { embeddingDims: EMBEDDING_DIMENSIONS, epochs: opts.epochs, lr: opts.lr, l2: opts.l2 } }), 'utf-8');
  console.log(`\n分類器を書き出し: ${opts.outPath}`);
}

void main();
