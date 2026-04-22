/**
 * メインスレッドからのテキスト生成 API。
 * Web Worker (generator.worker.ts) に対する Promise ベースのラッパー。
 */

import { GENERATION_MODEL_ID } from '@aozoraquest/core';

/**
 * ブラウザの Cache Storage に TinySwallow のモデルファイルが残っているか確認する。
 * Transformers.js は env.useBrowserCache=true のとき Cache API ("transformers-cache") を使う。
 * ONNX / tokenizer.json などが入っているかで cache の有無を判定する。
 * 権限 (HTTPS 必須など) 問題や Cache API 非対応の場合は false。
 */
export async function isModelCached(modelId: string = GENERATION_MODEL_ID): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      if (keys.some((req) => req.url.includes(modelId))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export interface GeneratorProgress {
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
  status?: string;
}

export type GeneratorProgressListener = (p: GeneratorProgress) => void;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface Pending {
  resolve: (full: string) => void;
  reject: (e: Error) => void;
  onToken?: (t: string) => void;
  acc: string;
}

export type GeneratorBackend = 'webgpu' | 'wasm';

export class Generator {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private listeners = new Set<GeneratorProgressListener>();
  private backend: GeneratorBackend | null = null;

  isReady(): boolean {
    return this.worker !== null && this.ready !== null;
  }

  getBackend(): GeneratorBackend | null {
    return this.backend;
  }

  addProgressListener(l: GeneratorProgressListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async load(): Promise<void> {
    if (this.ready) return this.ready;
    this.worker = new Worker(new URL('./generator.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (ev) => this.onMessage(ev));
    this.ready = new Promise<void>((resolve, reject) => {
      const onMsg = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.type === 'ready') {
          this.worker!.removeEventListener('message', onMsg);
          if (m.backend === 'webgpu' || m.backend === 'wasm') this.backend = m.backend;
          resolve();
        } else if (m.type === 'error' && !m.id) {
          this.worker!.removeEventListener('message', onMsg);
          reject(new Error(String(m.error)));
        }
      };
      this.worker!.addEventListener('message', onMsg);
      this.worker!.postMessage({ type: 'load' });
    });
    return this.ready;
  }

  private onMessage(ev: MessageEvent) {
    const m = ev.data;
    if (m.type === 'progress') {
      for (const l of this.listeners) l(m);
      return;
    }
    if (m.type === 'token' && m.id) {
      const p = this.pending.get(m.id);
      if (p) {
        p.acc += String(m.text);
        p.onToken?.(String(m.text));
      }
      return;
    }
    if (m.type === 'done' && m.id) {
      const p = this.pending.get(m.id);
      if (p) {
        this.pending.delete(m.id);
        // full が空なら acc を使う (token 経由で積み上げられた分)
        p.resolve(m.full && String(m.full).length > 0 ? String(m.full) : p.acc);
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

  async generate(messages: ChatMessage[], onToken?: (t: string) => void): Promise<string> {
    if (!this.worker) await this.load();
    await this.ready;
    const id = String(this.nextId++);
    return new Promise<string>((resolve, reject) => {
      const pending: Pending = { resolve, reject, acc: '' };
      if (onToken) pending.onToken = onToken;
      this.pending.set(id, pending);
      this.worker!.postMessage({ type: 'generate', id, messages });
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}

let singleton: Generator | null = null;
export function getGenerator(): Generator {
  if (!singleton) singleton = new Generator();
  return singleton;
}
