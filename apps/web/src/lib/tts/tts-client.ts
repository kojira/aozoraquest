/**
 * tts.worker を main thread から使う client (D-TTS-001)。Worker は初めて要る時に作り、1 つを使い回す。
 * - install(): 声のファイルを取得 (初回 約41MB、進捗つき) して読み込む。トグルを ON にしたときだけ呼ぶ。
 * - speak(): 読み込み済み (無ければキャッシュだけで読む) のエンジンで 1 行を合成し、PCM を返す。
 */
import type { TtsEmotion } from './tts-voice';

export type TtsProgress = (loaded: number, total: number) => void;
export interface TtsAudio { pcm: Float32Array; sampleRate: number }

/** 導入済みのはずの声のファイルがキャッシュから消えていた。 */
export class TtsNotInstalledError extends Error {
  constructor(detail: string) { super(`tts not installed: ${detail}`); this.name = 'TtsNotInstalledError'; }
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let progress: TtsProgress | undefined;
let nextId = 0;
const pending = new Map<string, { resolve: (a: TtsAudio) => void; reject: (e: Error) => void }>();

function dispose(): void {
  worker?.terminate();
  worker = null;
  ready = null;
  for (const p of pending.values()) p.reject(new Error('tts worker disposed'));
  pending.clear();
}

function start(allowNetwork: boolean): Promise<void> {
  if (ready) return ready;
  const w = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  ready = new Promise<void>((resolve, reject) => {
    w.addEventListener('message', (ev) => {
      const d = ev.data;
      if (d.type === 'progress') progress?.(d.loaded, d.total);
      else if (d.type === 'ready') resolve();
      else if (d.type === 'error' && !d.id) reject(d.code === 'not-cached' ? new TtsNotInstalledError(String(d.error)) : new Error(String(d.error)));
      else if (d.id) {
        const p = pending.get(d.id);
        pending.delete(d.id);
        if (d.type === 'spoken') p?.resolve({ pcm: d.pcm, sampleRate: d.sampleRate });
        else p?.reject(new Error(String(d.error)));
      }
    });
    w.addEventListener('error', (ev) => reject(new Error(`tts worker failed: ${ev.message}`)), { once: true });
    w.postMessage({ type: 'init', allowNetwork });
  });
  ready.catch(() => { if (worker === w) dispose(); });
  return ready;
}

export const ttsClient = {
  /** 声のファイルを取得して読み込む (ネットワーク可)。読み込み済みならすぐ終わる。 */
  install(onProgress?: TtsProgress): Promise<void> {
    progress = onProgress;
    return start(true).finally(() => { progress = undefined; });
  },
  async speak(text: string, emotion: TtsEmotion): Promise<TtsAudio> {
    await start(false);
    const w = worker;
    if (!w) throw new Error('tts worker disposed');
    const id = String(++nextId);
    return new Promise<TtsAudio>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ type: 'speak', id, text, emotion });
    });
  },
  dispose,
};
