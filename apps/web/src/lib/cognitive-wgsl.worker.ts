/**
 * 9-class cognitive classifier 専用 Worker (fine-tune 済 ModernBERT-ja 30m、手書き WGSL 推論)。
 *
 * onnxruntime は使わない: ORT の wasm memory は一度伸びると縮まず iOS Safari が落ちるため、
 * WebGPU 上の自前カーネル (cognitive-wgsl/) で推論する。WebGPU が無い環境では
 * { type: 'error', code: 'webgpu-unsupported' } を返し、ORT へのフォールバックはしない。
 *
 * tokenizer は @huggingface/tokenizers (純 JS、CPU)。transformers.js は import しない (cognitive-wgsl/tokenizer.ts)。
 *
 * メッセージ:
 *   { type: 'init' }                          → { type: 'ready' }
 *   { type: 'classify-batch', id, texts[] }   → { type: 'result-batch', id, scoresList: number[][] }
 *   { type: 'dispose' }                       → GPU buffer を destroy (worker は呼び出し側が terminate)
 */
import { CognitiveWgslModel, MAX_BATCH_SEQS, MAX_BATCH_TOKENS, WebGpuUnsupportedError } from './cognitive-wgsl/model';
import { planBatches, softmax } from './cognitive-wgsl/packing';
import { loadModernBertTokenizer, type ModernBertTokenizer } from './cognitive-wgsl/tokenizer';
import { COGNITIVE_WGSL_MODEL_URL, deleteCachedModel, pruneOrtCache } from './cognitive-wgsl/weights';

interface InitMessage { type: 'init'; modelUrl?: string }
interface ClassifyBatchMessage { type: 'classify-batch'; id: string; texts: string[] }
interface DisposeMessage { type: 'dispose' }
type IncomingMessage = InitMessage | ClassifyBatchMessage | DisposeMessage;

let ready: Promise<{ tokenizer: ModernBertTokenizer; model: CognitiveWgslModel }> | null = null;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

async function createModel(modelUrl: string): Promise<CognitiveWgslModel> {
  const onProgress = (loaded: number, total: number) => post({ type: 'progress', loaded, total });
  try {
    return await CognitiveWgslModel.create(modelUrl, onProgress);
  } catch (e) {
    if (e instanceof WebGpuUnsupportedError) throw e;
    // 途中で切れた応答がキャッシュされていた場合に備え、1 回だけキャッシュを消して取り直す
    console.warn('[cognitive] model load failed, retrying without cache', e);
    await deleteCachedModel(modelUrl);
    return await CognitiveWgslModel.create(modelUrl, onProgress);
  }
}

function ensureReady(modelUrl = COGNITIVE_WGSL_MODEL_URL) {
  if (!ready) {
    void pruneOrtCache();
    ready = (async () => {
      const model = await createModel(modelUrl);
      try {
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

async function classifyBatch(texts: string[]): Promise<number[][]> {
  const current = ensureReady();
  const { tokenizer, model } = await current;
  const seqs = texts.map((t) => tokenizer.encode(t));
  const out: number[][] = new Array(texts.length);
  try {
    for (const group of planBatches(seqs.map((s) => s.length), MAX_BATCH_TOKENS, MAX_BATCH_SEQS)) {
      const logits = await model.run(group.map((i) => seqs[i]!));
      group.forEach((i, k) => { out[i] = softmax(logits[k]!); });
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
    if (msg.type === 'classify-batch') {
      const scoresList = msg.texts.length === 0 ? [] : await classifyBatch(msg.texts);
      post({ type: 'result-batch', id: msg.id, scoresList });
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
