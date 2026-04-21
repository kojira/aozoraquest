/**
 * 埋め込み専用 Web Worker。
 * Ruri-v3-30m-ONNX をロードして、テキストをコサイン類似度比較可能な
 * 正規化ベクトル (Float32Array, 256 次元) に変換する。
 *
 * メッセージ:
 *   { type: 'init' }              → ロード開始、完了で { type: 'ready' }
 *   { type: 'embed', id, text }   → 埋め込み結果 { type: 'result', id, vec }
 *
 * 進捗は { type: 'progress', file, loaded, total, progress } で通知。
 */
import { pipeline, env } from '@huggingface/transformers';
import {
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL_ID,
} from '@aozoraquest/core';

env.allowLocalModels = false;
env.useBrowserCache = true;

type IncomingMessage =
  | { type: 'init'; device?: 'webgpu' | 'wasm' }
  | { type: 'embed'; id: string; text: string };

let extractor: any = null;

async function ensureExtractor(device: 'webgpu' | 'wasm' = 'webgpu'): Promise<void> {
  if (extractor) return;
  try {
    extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
      device,
      dtype: EMBEDDING_DTYPE,
      progress_callback: (p: any) => {
        (self as unknown as Worker).postMessage({
          type: 'progress',
          file: p.file,
          loaded: p.loaded,
          total: p.total,
          progress: p.progress,
          status: p.status,
        });
      },
    });
  } catch (e) {
    if (device === 'webgpu') {
      console.warn('WebGPU failed, falling back to WASM', e);
      extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
        device: 'wasm',
        dtype: EMBEDDING_DTYPE,
      });
    } else {
      throw e;
    }
  }
}

self.addEventListener('message', async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      await ensureExtractor(msg.device ?? 'webgpu');
      (self as unknown as Worker).postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'embed') {
      if (!extractor) await ensureExtractor('webgpu');
      const output = await extractor(msg.text, { pooling: 'mean', normalize: true });
      const vec = output.data as Float32Array;
      // 所有権を移してコピーを避ける
      (self as unknown as Worker).postMessage({ type: 'result', id: msg.id, vec }, { transfer: [vec.buffer] });
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      id: (msg as { id?: string }).id,
      error: String((e as Error)?.message ?? e),
    });
  }
});
