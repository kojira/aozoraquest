/**
 * メインスレッドからのエンベッダ API。
 * Web Worker (embedder.worker.ts、Ruri-v3-30m を手書き WGSL / WebGPU で推論) に対する Promise ベースのラッパー。
 */

export interface EmbedderProgress {
  loaded?: number;
  total?: number;
}

export type EmbedderProgressListener = (p: EmbedderProgress) => void;

/** WebGPU が使えない端末/ブラウザ。投稿時の解析は黙って飛ばし、診断は表示する。 */
export class EmbedderUnsupportedError extends Error {
  constructor() {
    super('この端末/ブラウザは WebGPU に対応していないため、気質の分析ができません (iOS 26 以降の Safari、または最新の Chrome / Edge が必要です)');
    this.name = 'EmbedderUnsupportedError';
  }
}

/** worker への 1 メッセージあたりの最大テキスト数 (進捗通知の粒度)。 */
const BATCH_SIZE = 32;

interface Pending { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }

function workerError(m: { code?: string; error?: unknown }): Error {
  if (m.code === 'webgpu-unsupported') return new EmbedderUnsupportedError();
  return new Error(String(m.error));
}

export class Embedder {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private listeners = new Set<EmbedderProgressListener>();

  addProgressListener(l: EmbedderProgressListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** modelUrl は parity 計測などでローカルの .aqw を指すときだけ渡す。 */
  async init(modelUrl?: string): Promise<void> {
    if (this.ready) return this.ready;
    const worker = new Worker(new URL('./embedder.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.addEventListener('message', (ev) => this.onMessage(ev));
    this.ready = new Promise<void>((resolve, reject) => {
      const onMsg = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.type === 'ready') {
          worker.removeEventListener('message', onMsg);
          resolve();
        } else if (m.type === 'error' && !m.id) {
          worker.removeEventListener('message', onMsg);
          reject(workerError(m));
        }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage(modelUrl ? { type: 'init', modelUrl } : { type: 'init' });
    });
    // 初期化失敗 (WebGPU 非対応・DL 失敗) は次回の呼び出しで作り直せるようにする
    this.ready.catch(() => { if (this.worker === worker) this.dispose(); });
    return this.ready;
  }

  private onMessage(ev: MessageEvent) {
    const m = ev.data;
    if (m.type === 'progress') {
      for (const l of this.listeners) l(m);
      return;
    }
    if (!m.id) return;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.type === 'result-batch') p.resolve(m.vecs as Float32Array[]);
    else if (m.type === 'error') p.reject(workerError(m));
  }

  private send(texts: string[]): Promise<Float32Array[]> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('embedder disposed'));
    const id = String(this.nextId++);
    return new Promise<Float32Array[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'embed-batch', id, texts });
    });
  }

  async embed(text: string): Promise<Float32Array> {
    await this.init();
    return (await this.send([text]))[0]!;
  }

  async embedBatch(texts: string[], onProgress?: (done: number, total: number) => void): Promise<Float32Array[]> {
    await this.init();
    const results: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      results.push(...await this.send(texts.slice(start, start + BATCH_SIZE)));
      onProgress?.(results.length, texts.length);
    }
    return results;
  }

  /** GPU buffer を destroy してから Worker を terminate する。 */
  dispose() {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) p.reject(new Error('embedder disposed'));
    this.pending.clear();
    if (!worker) return;
    const kill = setTimeout(() => worker.terminate(), 2000);
    worker.addEventListener('message', (ev) => {
      if (ev.data?.type === 'disposed') { clearTimeout(kill); worker.terminate(); }
    });
    worker.postMessage({ type: 'dispose' });
  }
}
