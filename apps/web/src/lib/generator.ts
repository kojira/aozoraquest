/**
 * メインスレッドからのテキスト生成 API。
 * Web Worker (generator.worker.ts) に対する Promise ベースのラッパー。
 */

import {
  DESKTOP_GENERATION_SPEC,
  MOBILE_GENERATION_SPEC,
  type GenerationModelSpec,
} from '@aozoraquest/core';
import { isLowEndDevice } from './device';
import { appendLlmTrace } from './llm-trace';

/** 端末種別ごとの LLM スペックを選ぶ。低スペック (mobile / RAM≤4GB) は
 *  Bonsai 1.7B q1 (~290MB)、それ以外は TinySwallow 1.5B q4f16。 */
function pickGenerationSpec(): GenerationModelSpec {
  return isLowEndDevice() ? MOBILE_GENERATION_SPEC : DESKTOP_GENERATION_SPEC;
}

/**
 * ブラウザの Cache Storage に LLM モデルファイルが残っているか確認する。
 * Transformers.js は env.useBrowserCache=true のとき Cache API ("transformers-cache") を使う。
 * ONNX / tokenizer.json などが入っているかで cache の有無を判定する。
 * 引数を省略した場合は端末別のデフォルト spec の modelId を見る。
 */
export async function isModelCached(
  modelId: string = pickGenerationSpec().modelId,
): Promise<boolean> {
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
      this.worker!.postMessage({ type: 'load', spec: pickGenerationSpec() });
    });
    return this.ready;
  }

  private onMessage(ev: MessageEvent) {
    const m = ev.data;
    if (m.type === 'trace') {
      // Worker 側の進捗を main の console に渡す + localStorage にも追記。
      // iOS Safari の OOM クラッシュ後に Web Inspector で console を再取得は
      // 不可能なので、reload 後にページから読めるよう永続化する。
      console.info('[gen-worker]', m.text);
      appendLlmTrace(m.text);
      return;
    }
    if (m.type === 'progress') {
      for (const l of this.listeners) l(m);
      // 進捗もダウンロード状況の判別に役立つので記録
      const file = (m as { file?: string }).file;
      const status = (m as { status?: string }).status;
      const progress = (m as { progress?: number }).progress;
      if (file && status) {
        appendLlmTrace(`progress: ${status} ${file}${progress != null ? ` ${Math.round(progress)}%` : ''}`);
      }
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

  async generate(
    messages: ChatMessage[],
    opts: { onToken?: (t: string) => void; temperature?: number } = {},
  ): Promise<string> {
    if (!this.worker) await this.load();
    await this.ready;
    const id = String(this.nextId++);
    return new Promise<string>((resolve, reject) => {
      const pending: Pending = { resolve, reject, acc: '' };
      if (opts.onToken) pending.onToken = opts.onToken;
      this.pending.set(id, pending);
      const msg: { type: 'generate'; id: string; messages: ChatMessage[]; temperature?: number } = {
        type: 'generate', id, messages,
      };
      if (opts.temperature !== undefined) msg.temperature = opts.temperature;
      this.worker!.postMessage(msg);
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
