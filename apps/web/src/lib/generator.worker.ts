/**
 * 生成 LLM (TinySwallow-1.5B-Instruct) 専用 Web Worker。
 *
 * メッセージ:
 *   { type: 'load' }                         → ロード完了で { type: 'ready', backend }
 *   { type: 'generate', id, messages }       → chunk を { type: 'token', id, text } で逐次、完了で { type: 'done', id, full }
 *
 * 進捗: { type: 'progress', file, loaded, total, progress, status }
 * エラー: { type: 'error', id?, error }
 *
 * backend: 'webgpu' (高速) → 失敗したら 'wasm' (遅いが動く) に fallback。
 */

import { pipeline, env, TextStreamer } from '@huggingface/transformers';
import {
  GENERATION_DTYPE,
  GENERATION_MAX_NEW_TOKENS,
  GENERATION_MODEL_ID,
  GENERATION_REPETITION_PENALTY,
  GENERATION_TEMPERATURE,
} from '@aozoraquest/core';

env.allowLocalModels = false;
env.useBrowserCache = true;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type IncomingMessage =
  | { type: 'load' }
  | { type: 'generate'; id: string; messages: ChatMessage[] };

type Backend = 'webgpu' | 'wasm';

let generator: any = null;
let activeBackend: Backend = 'webgpu';

async function tryCreate(device: Backend) {
  // WASM fallback では dtype が q4f16 のままだと動かないので q4 に下げる。
  const dtype = device === 'webgpu' ? GENERATION_DTYPE : 'q4';
  return await pipeline('text-generation', GENERATION_MODEL_ID, {
    device,
    dtype,
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
}

async function ensureGenerator(): Promise<void> {
  if (generator) return;
  try {
    generator = await tryCreate('webgpu');
    activeBackend = 'webgpu';
    console.info('[generator] ready: WebGPU');
  } catch (e) {
    console.warn('[generator] WebGPU failed, falling back to WASM', e);
    generator = await tryCreate('wasm');
    activeBackend = 'wasm';
    console.info('[generator] ready: WASM (slower)');
  }
}

self.addEventListener('message', async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === 'load') {
      await ensureGenerator();
      (self as unknown as Worker).postMessage({ type: 'ready', backend: activeBackend });
      return;
    }
    if (msg.type === 'generate') {
      if (!generator) await ensureGenerator();
      const id = msg.id;
      const tokenizer = generator.tokenizer;

      const streamer = new TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          if (text) {
            (self as unknown as Worker).postMessage({ type: 'token', id, text });
          }
        },
      });

      const output = await generator(msg.messages, {
        max_new_tokens: GENERATION_MAX_NEW_TOKENS,
        temperature: GENERATION_TEMPERATURE,
        repetition_penalty: GENERATION_REPETITION_PENALTY,
        do_sample: true,
        streamer,
      });

      let full = '';
      try {
        const first = Array.isArray(output) ? output[0] : output;
        const gen = first?.generated_text;
        if (Array.isArray(gen)) {
          const last = gen[gen.length - 1];
          full = typeof last?.content === 'string' ? last.content : '';
        } else if (typeof gen === 'string') {
          full = gen;
        }
      } catch {
        // ignore
      }

      (self as unknown as Worker).postMessage({ type: 'done', id, full });
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      id: (msg as { id?: string }).id,
      error: String((e as Error)?.message ?? e),
    });
  }
});
