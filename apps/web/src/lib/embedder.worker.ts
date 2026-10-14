/**
 * 埋め込み専用 Web Worker。Ruri-v3-30m (ModernBERT-ja-30m) を手書き WGSL (WebGPU) で動かし、
 * テキストをコサイン類似度比較可能な L2 正規化ベクトル (Float32Array, 256 次元) に変換する。
 *
 * onnxruntime は使わない (ORT の wasm memory は一度伸びると縮まないため)。WebGPU が無い環境では
 * { type: 'error', code: 'webgpu-unsupported' } を返し、別経路へのフォールバックはしない。
 * prefix は付けない (EMBEDDING_NEEDS_E5_PREFIX = false、prototype .bin も本文そのままで作っている)。
 *
 * メッセージ:
 *   { type: 'init', modelUrl? }           → { type: 'ready' }
 *   { type: 'embed-batch', id, texts[] }  → { type: 'result-batch', id, vecs: Float32Array[] }
 *   { type: 'dispose' }                   → GPU buffer を destroy して { type: 'disposed' }
 *
 * 進捗は { type: 'progress', loaded, total } で通知。
 */
import { CognitiveWgslModel, MAX_BATCH_SEQS, MAX_BATCH_TOKENS, WebGpuUnsupportedError } from './cognitive-wgsl/model';
import { planBatches } from './cognitive-wgsl/packing';
import { loadModernBertTokenizer, type ModernBertTokenizer } from './cognitive-wgsl/tokenizer';
import { RURI_WGSL_MODEL_URL, deleteCachedModel, pruneOrtCache } from './cognitive-wgsl/weights';

type IncomingMessage =
  | { type: 'init'; modelUrl?: string }
  | { type: 'embed-batch'; id: string; texts: string[] }
  | { type: 'dispose' };

let ready: Promise<{ tokenizer: ModernBertTokenizer; model: CognitiveWgslModel }> | null = null;

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, { transfer });

async function createModel(modelUrl: string): Promise<CognitiveWgslModel> {
  const onProgress = (loaded: number, total: number) => post({ type: 'progress', loaded, total });
  try {
    return await CognitiveWgslModel.create(modelUrl, onProgress);
  } catch (e) {
    if (e instanceof WebGpuUnsupportedError) throw e;
    // 途中で切れた応答がキャッシュされていた場合に備え、1 回だけキャッシュを消して取り直す
    console.warn('[embedder] model load failed, retrying without cache', e);
    await deleteCachedModel(modelUrl);
    return await CognitiveWgslModel.create(modelUrl, onProgress);
  }
}

function ensureReady(modelUrl = RURI_WGSL_MODEL_URL) {
  if (!ready) {
    void pruneOrtCache();
    ready = (async () => {
      const model = await createModel(modelUrl);
      try {
        if (model.head !== 'mean-pool') throw new Error(`embedder model must be mean-pool (got ${model.head})`);
        const tokenizer = await loadModernBertTokenizer();
        const current = ready;
        void model.lost.then(() => { if (ready === current) ready = null; });
        return { tokenizer, model };
      } catch (e) {
        model.dispose();
        throw e;
      }
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const current = ensureReady();
  const { tokenizer, model } = await current;
  const seqs = texts.map((t) => tokenizer.encode(t));
  const out: Float32Array[] = new Array(texts.length);
  try {
    for (const group of planBatches(seqs.map((s) => s.length), MAX_BATCH_TOKENS, MAX_BATCH_SEQS)) {
      const vecs = await model.run(group.map((i) => seqs[i]!));
      group.forEach((i, k) => { out[i] = vecs[k]!.slice(); });
    }
  } catch (e) {
    // GPU error で壊れた model は捨て、次の呼び出しで作り直す
    if (model.broken && ready === current) {
      ready = null;
      model.dispose();
    }
    throw e;
  }
  return out;
}

self.addEventListener('message', async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      await ensureReady(msg.modelUrl);
      post({ type: 'ready' });
      return;
    }
    if (msg.type === 'embed-batch') {
      const vecs = msg.texts.length === 0 ? [] : await embedBatch(msg.texts);
      post({ type: 'result-batch', id: msg.id, vecs }, vecs.map((v) => v.buffer));
      return;
    }
    if (msg.type === 'dispose') {
      const cur = ready;
      ready = null;
      if (cur) (await cur.catch(() => null))?.model.dispose();
      post({ type: 'disposed' });
    }
  } catch (e) {
    post({
      type: 'error',
      id: (msg as { id?: string }).id,
      code: e instanceof WebGpuUnsupportedError ? 'webgpu-unsupported' : 'failed',
      error: String((e as Error)?.message ?? e),
    });
  }
});
