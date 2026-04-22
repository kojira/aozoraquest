/**
 * 9-class cognitive classifier 専用 Worker (fine-tune 済 ModernBERT-ja 130m)。
 *
 * transformers.js pipeline('text-classification', ...) で local ONNX をロードし、
 * 投稿 text → 9 class softmax 確率を返す。
 *
 * 優先度: WebGPU + int4 (q4) → WASM + int8 (q8)。
 * WebGPU int8 (q8) は ORT-web 1.24.3 でも計算破綻するので使わない。
 *
 * メッセージ:
 *   { type: 'init' }                          → { type: 'ready', backend, dtype }
 *   { type: 'classify', id, text }            → { type: 'result', id, scores: number[9] }
 *   { type: 'classify-batch', id, texts[] }   → { type: 'result-batch', id, scoresList: number[][] }
 */
import { pipeline, env } from '@huggingface/transformers';

// Vite dev server は public/ を / に配信するので、local model を有効化する。
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/';
// transformers.js の Cache API (transformers-cache) を使う: 248MB DL を永続化
// し、2 回目以降の起動を瞬時にする。
// 注意点: Cache API は HTTP cache と別で Cache-Control に従わないため、一度
// 汚染された応答 (SPA fallback の 297 byte HTML、DL 途中中断など) が保存されると
// 永遠に壊れたまま読み続ける。対策として、
//   1. 起動時に transformers-cache を走査し、小さすぎる (< 1MB) エントリは
//      事前に削除する (汚染応答をキャッシュから排除)
//   2. pipeline 作成時に protobuf error を検知したらキャッシュを消して retry
// の 2 段構えで自動回復できるようにしている (下の ensureClassifier 参照)。
env.useBrowserCache = true;

type Device = 'webgpu' | 'wasm';
type Dtype = 'q4' | 'q8';

interface InitMessage { type: 'init' }
interface ClassifyMessage { type: 'classify'; id: string; text: string }
interface ClassifyBatchMessage { type: 'classify-batch'; id: string; texts: string[] }
type IncomingMessage = InitMessage | ClassifyMessage | ClassifyBatchMessage;

const MODEL_NAME = 'cognitive-onnx';
const LABELS = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe', 'none'] as const;

let classifier: any = null;
let activeBackend: Device = 'webgpu';
let activeDtype: Dtype = 'q4';

async function tryCreate(device: Device, dtype: Dtype) {
  return await pipeline('text-classification', MODEL_NAME, {
    device,
    dtype,
    progress_callback: (p: any) => {
      (self as unknown as Worker).postMessage({
        type: 'progress', file: p.file, loaded: p.loaded, total: p.total,
        progress: p.progress, status: p.status,
      });
    },
  });
}

/**
 * transformers.js は Cache API (transformers-cache) に model を保存するが、
 * 初回取得時に dev server の SPA fallback (index.html) が返っていた場合、
 * 汚染された 297 byte HTML が永続キャッシュされて以降 "protobuf parsing
 * failed" で永遠に起動しない。そのエラー時はキャッシュを一掃してリトライ。
 */
function isProtobufError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return msg.includes('protobuf') || msg.includes('ERROR_CODE: 7');
}

async function clearPoisonedCache(): Promise<void> {
  try {
    const names = await caches.keys();
    for (const n of names) {
      if (n.includes('transformers') || n.includes('cognitive-onnx')) {
        await caches.delete(n);
      }
    }
  } catch (e) {
    console.warn('[cognitive] cache clear failed', e);
  }
}

/**
 * 起動時に transformers-cache を走査し、明らかに壊れている (model を名乗るが
 * 数 KB しかない) エントリを事前に削除する。protobuf parse 失敗を事前予防。
 */
async function pruneTinyModelEntries(): Promise<void> {
  try {
    const names = await caches.keys();
    for (const n of names) {
      if (!n.includes('transformers')) continue;
      const cache = await caches.open(n);
      const reqs = await cache.keys();
      for (const req of reqs) {
        if (!req.url.endsWith('.onnx')) continue;
        const res = await cache.match(req);
        if (!res) continue;
        const sizeHeader = res.headers.get('content-length');
        const size = sizeHeader ? parseInt(sizeHeader, 10) : NaN;
        // 1MB 未満の .onnx は汚染確定 (最小モデルでも数十MB)
        if (!Number.isFinite(size) || size < 1_000_000) {
          console.warn(`[cognitive] pruning tiny cached entry: ${req.url} (${size} bytes)`);
          await cache.delete(req);
        }
      }
    }
  } catch (e) {
    console.warn('[cognitive] cache prune failed', e);
  }
}

async function createWithRecovery(device: Device, dtype: Dtype) {
  try {
    return await tryCreate(device, dtype);
  } catch (e) {
    if (!isProtobufError(e)) throw e;
    console.warn(`[cognitive] ${device}/${dtype} protobuf error, clearing cache and retrying`, e);
    await clearPoisonedCache();
    return await tryCreate(device, dtype);
  }
}

async function ensureClassifier(): Promise<void> {
  if (classifier) return;
  // 初回起動前に tiny 汚染エントリを掃除 (protobuf error を事前予防)
  await pruneTinyModelEntries();
  try {
    classifier = await createWithRecovery('webgpu', 'q4');
    activeBackend = 'webgpu'; activeDtype = 'q4';
    console.info('[cognitive] ready: WebGPU + int4');
  } catch (e) {
    console.warn('[cognitive] WebGPU q4 failed, falling back to WASM q8', e);
    classifier = await createWithRecovery('wasm', 'q8');
    activeBackend = 'wasm'; activeDtype = 'q8';
    console.info('[cognitive] ready: WASM + int8');
  }
}

/** text-classification pipeline は top_k 指定で全 label 確率を返すので、label 順序を揃える。 */
function pipelineToScores(out: Array<{ label: string; score: number }>): number[] {
  const scores = new Array<number>(LABELS.length).fill(0);
  for (const item of out) {
    const idx = LABELS.indexOf(item.label as typeof LABELS[number]);
    if (idx >= 0) scores[idx] = item.score;
  }
  return scores;
}

/**
 * pipeline にテキスト配列を渡したときの戻り値を正規化する。
 * transformers.js のバージョンによって:
 *  - Array<Array<{label,score}>> (期待どおり、text ごとに label リスト)
 *  - Array<{label,score}> (flat: top_k=1 + 単一入力の慣習が混じった出力)
 * のどちらもあり得るので両対応。
 */
function normalizeBatchOutput(raw: unknown, batchSize: number): number[][] {
  if (!Array.isArray(raw)) return Array.from({ length: batchSize }, () => new Array(LABELS.length).fill(0));
  // nested: 最初の要素が配列
  if (Array.isArray(raw[0])) {
    return (raw as Array<Array<{ label: string; score: number }>>).map(pipelineToScores);
  }
  // flat: 単一 input の結果を 1 要素 list として扱うケース
  if (batchSize === 1) {
    return [pipelineToScores(raw as Array<{ label: string; score: number }>)];
  }
  // 想定外: 空で埋める
  return Array.from({ length: batchSize }, () => new Array(LABELS.length).fill(0));
}

self.addEventListener('message', async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      await ensureClassifier();
      (self as unknown as Worker).postMessage({
        type: 'ready', backend: activeBackend, dtype: activeDtype, labels: LABELS,
      });
      return;
    }
    if (msg.type === 'classify') {
      if (!classifier) await ensureClassifier();
      const out = await classifier(msg.text, { top_k: LABELS.length });
      const scores = pipelineToScores(out as any);
      (self as unknown as Worker).postMessage({ type: 'result', id: msg.id, scores });
    }
    if (msg.type === 'classify-batch') {
      if (!classifier) await ensureClassifier();
      if (msg.texts.length === 0) {
        (self as unknown as Worker).postMessage({ type: 'result-batch', id: msg.id, scoresList: [] });
        return;
      }
      // transformers.js は配列入力を受けて 1 回の sess.run でバッチ推論する。
      // padding は text-classification pipeline 内部で longest に揃えられる。
      const out = await classifier(msg.texts, { top_k: LABELS.length });
      const scoresList = normalizeBatchOutput(out, msg.texts.length);
      (self as unknown as Worker).postMessage({ type: 'result-batch', id: msg.id, scoresList });
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      id: (msg as { id?: string }).id,
      error: String((e as Error)?.message ?? e),
    });
  }
});
