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
 *   { type: 'init' }                  → 準備完了で { type: 'ready', backend, dtype }
 *   { type: 'classify', id, text }    → 結果 { type: 'result', id, scores: number[9] }
 */
import { pipeline, env } from '@huggingface/transformers';

// Vite dev server は public/ を / に配信するので、local model を有効化する。
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/';

type Device = 'webgpu' | 'wasm';
type Dtype = 'q4' | 'q8';

interface InitMessage { type: 'init' }
interface ClassifyMessage { type: 'classify'; id: string; text: string }
type IncomingMessage = InitMessage | ClassifyMessage;

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
  try {
    classifier = await createWithRecovery('webgpu', 'q4');
    activeBackend = 'webgpu'; activeDtype = 'q4';
  } catch (e) {
    console.warn('[cognitive] WebGPU q4 failed, falling back to WASM q8', e);
    classifier = await createWithRecovery('wasm', 'q8');
    activeBackend = 'wasm'; activeDtype = 'q8';
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
  } catch (e) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      id: (msg as { id?: string }).id,
      error: String((e as Error)?.message ?? e),
    });
  }
});
