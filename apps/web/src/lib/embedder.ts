/**
 * メインスレッドからのエンベッダ API。
 * Web Worker (embedder.worker.ts) に対する Promise ベースのラッパー。
 */

export interface EmbedderProgress {
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
  status?: string;
}

export type EmbedderProgressListener = (p: EmbedderProgress) => void;

export class Embedder {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>();
  private nextId = 0;
  private listeners = new Set<EmbedderProgressListener>();

  addProgressListener(l: EmbedderProgressListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async init(device: 'webgpu' | 'wasm' = 'webgpu'): Promise<void> {
    if (this.ready) return this.ready;
    this.worker = new Worker(new URL('./embedder.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (ev) => this.onMessage(ev));
    this.ready = new Promise<void>((resolve, reject) => {
      const onMsg = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.type === 'ready') {
          this.worker!.removeEventListener('message', onMsg);
          resolve();
        } else if (m.type === 'error' && !m.id) {
          this.worker!.removeEventListener('message', onMsg);
          reject(new Error(String(m.error)));
        }
      };
      this.worker!.addEventListener('message', onMsg);
      this.worker!.postMessage({ type: 'init', device });
    });
    return this.ready;
  }

  private onMessage(ev: MessageEvent) {
    const m = ev.data;
    if (m.type === 'progress') {
      for (const l of this.listeners) l(m);
      return;
    }
    if (m.type === 'result' && m.id) {
      const p = this.pending.get(m.id);
      if (p) {
        this.pending.delete(m.id);
        p.resolve(m.vec as Float32Array);
      }
      return;
    }
    if (m.type === 'error' && m.id) {
      const p = this.pending.get(m.id);
      if (p) {
        this.pending.delete(m.id);
        p.reject(new Error(String(m.error)));
      }
    }
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.worker) await this.init();
    await this.ready;
    const id = String(this.nextId++);
    return new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'embed', id, text });
    });
  }

  async embedBatch(texts: string[], onProgress?: (done: number, total: number) => void): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(await this.embed(texts[i]!));
      onProgress?.(i + 1, texts.length);
    }
    return results;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}

let singleton: Embedder | null = null;
export function getEmbedder(): Embedder {
  if (!singleton) singleton = new Embedder();
  return singleton;
}
