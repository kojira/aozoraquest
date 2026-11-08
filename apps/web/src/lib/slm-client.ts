/**
 * 自前 WGSL の Worker (slm.worker.ts) を main thread から使うための client。1 client = 1 モデル (LFM か sarashina)。
 *
 * - Worker は初めて要る時に作り、最後の生成から 3 分で解放する。pagehide でも解放し、GPU device を失ったら作り直す。
 * - ensure(true) は導入 (召喚の儀式) だけが使う。翻訳・カードの読み込み (ensure(false) / generate) はキャッシュだけを読み、
 *   欠けていれば SlmNotInstalledError で失敗する (呼び出し側が未導入に戻す)。
 * - 端末の空きが足りず Cache API へ書けなかったら SlmStorageFullError で失敗する。
 */
import type { SlmWorkerModel } from './slm.worker';

const IDLE_DISPOSE_MS = 3 * 60_000;
/** 読み込み中にこの間 progress が 1 つも届かなければ止まったとみなして Worker を捨てる (総時間の上限は設けない)。 */
const LOAD_STALL_MS = 60_000;

/** 読み込みで、導入済みのはずのキャッシュが欠けていた (ブラウザに消された)。 */
export class SlmNotInstalledError extends Error {
  constructor(detail: string) {
    super(`slm not installed: ${detail}`);
    this.name = 'SlmNotInstalledError';
  }
}

/** 導入中に端末の空きが足りず、重みを Cache API に書けなかった。 */
export class SlmStorageFullError extends Error {
  constructor(detail: string) {
    super(`slm storage full: ${detail}`);
    this.name = 'SlmStorageFullError';
  }
}

/** 導入中の進捗。loaded / total は重み part の byte 数。 */
export type SlmProgress = (loaded: number, total: number) => void;

export interface SlmGenerateRequest {
  prompt: string;
  maxNewTokens: number;
  temperature: number;
  repetitionPenalty: number;
  stopAtNewline: boolean;
  signal?: AbortSignal | undefined;
}

interface Pending { resolve: (text: string) => void; reject: (e: Error) => void }

export interface SlmClient {
  ensure(allowNetwork: boolean, onProgress?: SlmProgress): Promise<void>;
  /** 読み込み済み / 読み込み中の Worker の完了を待つ (失敗は無視)。 */
  settle(): Promise<void>;
  generate(req: SlmGenerateRequest): Promise<string>;
  /** prompt の token 数 (読み込み済みの tokenizer で数える)。 */
  countTokens(prompt: string): Promise<number>;
  dispose(): void;
}

export function createSlmClient(model: SlmWorkerModel): SlmClient {
  let worker: Worker | null = null;
  let workerReady: Promise<void> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 0;
  const pending = new Map<string, Pending>();
  let progressListener: SlmProgress | undefined;

  function dispose() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const w = worker;
    worker = null;
    workerReady = null;
    for (const p of pending.values()) p.reject(new Error(`${model} worker disposed`));
    pending.clear();
    if (!w) return;
    const kill = setTimeout(() => w.terminate(), 2000);
    w.addEventListener('message', (ev) => {
      if (ev.data?.type === 'disposed') { clearTimeout(kill); w.terminate(); }
    });
    w.postMessage({ type: 'dispose' });
  }

  function touchIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(dispose, IDLE_DISPOSE_MS);
  }

  /** Worker を作って読み込む。読み込み済み / 読み込み中ならそれを返す (進捗の受け手だけ差しかえる)。 */
  function ensure(allowNetwork: boolean, onProgress?: SlmProgress): Promise<void> {
    progressListener = onProgress;
    if (workerReady) return workerReady;
    const w = new Worker(new URL('./slm.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    w.addEventListener('message', (ev) => {
      const m = ev.data;
      if (m.type === 'lost') {
        if (worker === w) { worker = null; workerReady = null; }
        w.terminate();
        for (const p of pending.values()) p.reject(new Error(`${model} GPU device lost`));
        pending.clear();
        return;
      }
      if (!m.id) return;
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === 'done') p.resolve(m.text as string);
      else if (m.type === 'counted') p.resolve(String(m.count));
      else p.reject(new Error(String(m.error)));
    });
    const ready = new Promise<void>((resolve, reject) => {
      let stall = setTimeout(onStall, LOAD_STALL_MS);
      function onStall() { w.removeEventListener('message', onMsg); reject(new Error(`${model} load stalled (${LOAD_STALL_MS}ms without progress)`)); }
      const onMsg = (ev: MessageEvent) => {
        const d = ev.data;
        if (d.type === 'progress') {
          clearTimeout(stall);
          stall = setTimeout(onStall, LOAD_STALL_MS);
          if (typeof d.loaded === 'number') progressListener?.(d.loaded, d.total);
        } else if (d.type === 'ready') { clearTimeout(stall); w.removeEventListener('message', onMsg); resolve(); }
        else if (d.type === 'error' && !d.id) {
          clearTimeout(stall);
          w.removeEventListener('message', onMsg);
          if (d.code === 'not-cached') reject(new SlmNotInstalledError(String(d.error)));
          else if (d.code === 'storage-full') reject(new SlmStorageFullError(String(d.error)));
          else reject(new Error(String(d.error)));
        }
      };
      w.addEventListener('message', onMsg);
      w.addEventListener('error', (ev) => { clearTimeout(stall); reject(new Error(`${model} worker failed: ${ev.message}`)); }, { once: true });
      w.postMessage({ type: 'init', model, allowNetwork });
    });
    workerReady = ready;
    ready.then(() => { progressListener = undefined; }, (e: unknown) => {
      console.warn(`[${model}] init failed`, e);
      if (worker === w) dispose();
    });
    return ready;
  }

  async function generate(req: SlmGenerateRequest): Promise<string> {
    await ensure(false);
    const w = worker;
    if (!w) throw new Error(`${model} worker disposed`);
    const id = String(nextId++);
    try {
      return await new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        req.signal?.addEventListener('abort', () => { pending.delete(id); reject(new Error('aborted')); });
        const { signal: _signal, ...msg } = req;
        w.postMessage({ type: 'generate', id, ...msg });
      });
    } finally {
      touchIdle();
    }
  }

  async function countTokens(prompt: string): Promise<number> {
    await ensure(false);
    const w = worker;
    if (!w) throw new Error(`${model} worker disposed`);
    const id = String(nextId++);
    const n = await new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ type: 'count', id, prompt });
    });
    return Number(n);
  }

  if (typeof window !== 'undefined') window.addEventListener('pagehide', dispose);

  return {
    ensure,
    async settle() { if (workerReady) await workerReady.catch(() => undefined); },
    generate,
    countTokens,
    dispose,
  };
}
