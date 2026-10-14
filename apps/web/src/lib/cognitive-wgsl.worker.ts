/**
 * 9-class cognitive classifier 専用 Worker (fine-tune 済 ModernBERT-ja 30m、手書き WGSL 推論)。
 *
 * onnxruntime は使わない: ORT の wasm memory は一度伸びると縮まず iOS Safari が落ちるため、
 * WebGPU 上の自前カーネル (cognitive-wgsl/) で推論する。WebGPU が無い環境では
 * { type: 'error', code: 'webgpu-unsupported' } を返し、ORT へのフォールバックはしない。
 *
 * tokenizer は transformers.js の AutoTokenizer (CPU、tokenizer.json のみ取得)。
 * AutoTokenizer は推論 session を作らないので ORT の wasm は読み込まれない。
 *
 * メッセージ:
 *   { type: 'init' }                          → { type: 'ready' }
 *   { type: 'classify-batch', id, texts[] }   → { type: 'result-batch', id, scoresList: number[][] }
 *   { type: 'dispose' }                       → GPU buffer を destroy (worker は呼び出し側が terminate)
 */
import { AutoTokenizer, env } from '@huggingface/transformers';
import { CognitiveWgslModel, MAX_BATCH_SEQS, MAX_BATCH_TOKENS, WebGpuUnsupportedError } from './cognitive-wgsl/model';
import { MAX_SEQ_TOKENS } from './cognitive-wgsl/kernels';
import { planBatches, softmax } from './cognitive-wgsl/packing';
import { COGNITIVE_WGSL_MODEL_URL, deleteCachedModel } from './cognitive-wgsl/weights';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

const TOKENIZER_REPO = 'kojira/aozoraquest-cognitive-small';

interface InitMessage { type: 'init'; modelUrl?: string }
interface ClassifyBatchMessage { type: 'classify-batch'; id: string; texts: string[] }
interface DisposeMessage { type: 'dispose' }
type IncomingMessage = InitMessage | ClassifyBatchMessage | DisposeMessage;

type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;

let ready: Promise<{ tokenizer: Tokenizer; model: CognitiveWgslModel }> | null = null;

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

/**
 * 旧 ORT 版が transformers-cache に保存した cognitive の .onnx (約 37MB) はもう読まないので消す。
 * tokenizer.json などと、他モデル (Ruri) のエントリは残す。
 */
async function pruneOrtModelCache(): Promise<void> {
  try {
    for (const name of await caches.keys()) {
      if (!name.includes('transformers')) continue;
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        if (req.url.includes('kojira/aozoraquest-cognitive') && req.url.endsWith('.onnx')) await cache.delete(req);
      }
    }
  } catch (e) {
    console.warn('[cognitive] cache prune failed', e);
  }
}

function ensureReady(modelUrl = COGNITIVE_WGSL_MODEL_URL) {
  if (!ready) {
    void pruneOrtModelCache();
    ready = (async () => {
      const model = await createModel(modelUrl);
      try {
        const tokenizer = await AutoTokenizer.from_pretrained(TOKENIZER_REPO);
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

/** 1 系列のトークン数を attention の上限に収める (末尾の </s> は残す)。 */
function clampIds(ids: number[]): number[] {
  if (ids.length <= MAX_SEQ_TOKENS) return ids;
  return [...ids.slice(0, MAX_SEQ_TOKENS - 1), ids[ids.length - 1]!];
}

async function classifyBatch(texts: string[]): Promise<number[][]> {
  const current = ensureReady();
  const { tokenizer, model } = await current;
  const seqs = texts.map((t) => clampIds(tokenizer.encode(t)));
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
