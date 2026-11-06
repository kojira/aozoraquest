/**
 * Blueskyちゃんの声の合成専用 Worker (D-TTS-001)。ZEN-TTS 1.2.0 をそのまま使う (改変しない)。
 *
 * メッセージ:
 *   { type: 'init', allowNetwork }  → 取得中は { type: 'progress', loaded, total } → { type: 'ready', backend } / { type: 'error', code? }
 *                                     (声・G2P・CPU カーネルを tts-v1 から読む。allowNetwork: false で欠けていれば code: 'not-cached')
 *   { type: 'speak', id, text, emotion } → { type: 'spoken', id, pcm (transfer), sampleRate } / { type: 'error', id }
 *                                     (文ごとに同じ感情で順に合成し、0.15 秒の無音でつないだ 1 本を返す)
 * WebGPU があれば GPU、無ければ ZEN-TTS 自身の CPU (WASM SIMD、さらにその中の Worker)。
 */
import { ZenTts } from 'zen-tts';
import { TTS_ASSETS, TTS_CACHE_NAME, TTS_CPU_WASM_URL, TTS_MODELS_URL, TTS_TOTAL_BYTES, TTS_ZTM_URL } from './tts-assets';
import { fetchTtsAsset, TtsNotCachedError, type TtsCacheLike } from './tts-cache';
import { cachedAssetFetch } from './tts-fetch';
import { joinSentencePcm, splitSentences } from './split-sentences';
import type { TtsEmotion } from './tts-voice';

type Incoming = { type: 'init'; allowNetwork: boolean } | { type: 'speak'; id: string; text: string; emotion: TtsEmotion };

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
let engine: Promise<ZenTts> | null = null;
/** 合成は 1 本ずつ順に (GPU / CPU の状態を共有するため)。 */
let queue: Promise<unknown> = Promise.resolve();

async function openCache(): Promise<TtsCacheLike | null> {
  try { return await caches.open(TTS_CACHE_NAME); } catch { return null; }
}

function load(allowNetwork: boolean): Promise<ZenTts> {
  return engine ??= (async () => {
    const cache = await openCache();
    const done = new Map<string, number>();
    const report = () => post({ type: 'progress', loaded: [...done.values()].reduce((a, b) => a + b, 0), total: TTS_TOTAL_BYTES });
    const files = new Map<string, ArrayBuffer>();
    await Promise.all(TTS_ASSETS.map(async (a) => {
      const buf = await fetchTtsAsset(a, cache, { allowNetwork, onBytes: (n) => { done.set(a.url, n); report(); } });
      files.set(new URL(a.url, self.location.href).href, buf);
    }));
    globalThis.fetch = cachedAssetFetch(files, self.location.href, globalThis.fetch.bind(globalThis));
    return ZenTts.load({ model: TTS_ZTM_URL, modelsUrl: TTS_MODELS_URL, cpuWasmUrl: TTS_CPU_WASM_URL, backend: 'auto' });
  })();
}

self.onmessage = (ev: MessageEvent<Incoming>) => {
  const m = ev.data;
  if (m.type === 'init') {
    load(m.allowNetwork).then((tts) => post({ type: 'ready', backend: tts.backend }), (e: unknown) => {
      engine = null;
      post({ type: 'error', code: e instanceof TtsNotCachedError ? 'not-cached' : undefined, error: String((e as Error)?.message ?? e) });
    });
    return;
  }
  if (m.type === 'speak') {
    queue = queue.then(async () => {
      try {
        const tts = await load(false);
        const pieces: Float32Array[] = [];
        let sampleRate = 0;
        for (const sentence of splitSentences(m.text)) {
          const r = await tts.speak(sentence, { emotion: m.emotion });
          pieces.push(r.audio);
          sampleRate = r.sampleRate;
        }
        const pcm = joinSentencePcm(pieces, sampleRate);
        post({ type: 'spoken', id: m.id, pcm, sampleRate }, [pcm.buffer]);
      } catch (e) {
        post({ type: 'error', id: m.id, error: String((e as Error)?.message ?? e) });
      }
    });
  }
};
