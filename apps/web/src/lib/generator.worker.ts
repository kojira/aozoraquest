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
  DESKTOP_GENERATION_SPEC,
  GENERATION_MAX_NEW_TOKENS,
  GENERATION_REPETITION_PENALTY,
  GENERATION_TEMPERATURE,
  type GenerationModelSpec,
} from '@aozoraquest/core';

env.allowLocalModels = false;
env.useBrowserCache = true;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type IncomingMessage =
  | { type: 'load'; spec?: GenerationModelSpec }
  | { type: 'generate'; id: string; messages: ChatMessage[]; temperature?: number };

type Backend = 'webgpu' | 'wasm';

let generator: any = null;
let activeBackend: Backend = 'webgpu';
// load 時に上書きされるが、未指定で来た場合は Desktop 設定にフォールバック
let activeSpec: GenerationModelSpec = DESKTOP_GENERATION_SPEC;

async function tryCreate(device: Backend) {
  const dtype = device === 'webgpu' ? activeSpec.webgpuDtype : activeSpec.wasmDtype;
  return await pipeline('text-generation', activeSpec.modelId, {
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
  if (activeSpec.preferWasm) {
    generator = await tryCreate('wasm');
    activeBackend = 'wasm';
    return;
  }
  try {
    generator = await tryCreate('webgpu');
    activeBackend = 'webgpu';
  } catch (e) {
    if (!activeSpec.allowWasm) throw e;
    console.warn('[generator] WebGPU failed, falling back to WASM', e);
    generator = await tryCreate('wasm');
    activeBackend = 'wasm';
  }
}

self.addEventListener('message', async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === 'load') {
      if (msg.spec) activeSpec = msg.spec;
      await ensureGenerator();
      (self as unknown as Worker).postMessage({
        type: 'ready', backend: activeBackend, modelId: activeSpec.modelId,
      });
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

      const temp = msg.temperature ?? GENERATION_TEMPERATURE;
      const output = await generator(msg.messages, {
        max_new_tokens: GENERATION_MAX_NEW_TOKENS,
        temperature: temp,
        repetition_penalty: GENERATION_REPETITION_PENALTY,
        // temperature=0 はサンプリング不要 (greedy) なので do_sample を切る
        do_sample: temp > 0,
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
