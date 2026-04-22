/**
 * fine-tune 済 9-class cognitive classifier の main-thread ラッパー。
 *
 * 処理パイプライン (Python infer-best.py と同一):
 *   1. preprocessText (URL/hashtag/mention 除去)
 *   2. hasJapanese (ja 比率 < 0.5 は分類不能扱い)
 *   3. splitLongPost (120 字以上は 括弧外「。！？!?」で分割)
 *   4. 各 piece を 9-class softmax で推論
 *   5. 全 piece の確率を mean aggregate
 *   6. none を除いた 8 class を normalizeCognitive で 0-100 にリスケール
 *
 * Worker は singleton で保持。初回 init で WebGPU + int4 を試し、失敗したら
 * WASM + int8 にフォールバック。
 */

import type { CogFunction, CognitiveScores } from '@aozoraquest/core';
import { normalizeCognitive } from '@aozoraquest/core';
import { preprocessText, hasJapanese, splitLongPost } from './japanese-text';

export type CognitiveBackend = 'webgpu' | 'wasm';
export type CognitiveDtype = 'q4' | 'q8';

const LABELS_9 = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe', 'none'] as const;
const COGNITIVE_8: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

export class CognitiveOnnxClassifier {
  private worker: Worker | null = null;
  private ready: Promise<{ backend: CognitiveBackend; dtype: CognitiveDtype }> | null = null;
  private pending = new Map<string, { resolve: (v: number[]) => void; reject: (e: Error) => void }>();
  private nextId = 0;
  private info: { backend: CognitiveBackend; dtype: CognitiveDtype } | null = null;

  async init(): Promise<{ backend: CognitiveBackend; dtype: CognitiveDtype }> {
    if (this.ready) return this.ready;
    this.worker = new Worker(new URL('./cognitive-onnx.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (ev) => this.onMessage(ev));
    this.ready = new Promise((resolve, reject) => {
      const onMsg = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.type === 'ready') {
          this.worker!.removeEventListener('message', onMsg);
          this.info = { backend: m.backend, dtype: m.dtype };
          resolve(this.info);
        } else if (m.type === 'error' && !m.id) {
          this.worker!.removeEventListener('message', onMsg);
          reject(new Error(String(m.error)));
        }
      };
      this.worker!.addEventListener('message', onMsg);
      this.worker!.postMessage({ type: 'init' });
    });
    return this.ready;
  }

  getInfo(): { backend: CognitiveBackend; dtype: CognitiveDtype } | null { return this.info; }

  private onMessage(ev: MessageEvent) {
    const m = ev.data;
    if (m.type === 'result' && m.id) {
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); p.resolve(m.scores as number[]); }
      return;
    }
    if (m.type === 'error' && m.id) {
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); p.reject(new Error(String(m.error))); }
    }
  }

  /**
   * 単一 text の 9-class softmax 確率 (LABELS_9 順) を返す。
   * timeoutMs を過ぎたら reject して pending を削除 (ハング対策)。
   */
  async classifyRaw(text: string, timeoutMs = 15000): Promise<number[]> {
    if (!this.worker) await this.init();
    await this.ready;
    const id = String(this.nextId++);
    return new Promise<number[]>((resolve, reject) => {
      const to = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cognitive-onnx timeout ${timeoutMs}ms "${text.slice(0, 30)}"`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(to); resolve(v); },
        reject: (e) => { clearTimeout(to); reject(e); },
      });
      this.worker!.postMessage({ type: 'classify', id, text });
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.info = null;
  }

  /** 本番パイプライン: text → preprocess → split → per-piece 推論 → mean → 8-class normalize。 */
  async classifyPost(rawText: string, splitThreshold = 120): Promise<CognitiveScores | null> {
    const pre = preprocessText(rawText);
    if (pre.length < 8) return null;
    if (!hasJapanese(pre)) return null;

    const pieces = splitLongPost(pre, splitThreshold);
    // piece は直列で処理。並列にするとメモリ圧が上がり、特定 piece が
    // ハングしたとき他の piece も道連れになって進捗が止まるため。
    const perPiece: number[][] = [];
    for (const p of pieces) {
      try {
        perPiece.push(await this.classifyRaw(p));
      } catch (e) {
        console.warn('[cognitive] piece classify failed, skipping piece', e);
      }
    }
    if (perPiece.length === 0) return null;

    // 各次元を piece 数で平均 (WHOLE 含む全 piece を等重み)
    const nDim = LABELS_9.length;
    const avg = new Array<number>(nDim).fill(0);
    for (const s of perPiece) {
      for (let i = 0; i < nDim; i++) avg[i]! += s[i]! / perPiece.length;
    }

    // none を捨てて 8-class の raw スコアを作る (softmax のまま比率は保つ)
    const raw = {} as CognitiveScores;
    for (const fn of COGNITIVE_8) {
      const idx = LABELS_9.indexOf(fn);
      raw[fn] = avg[idx] ?? 0;
    }
    return normalizeCognitive(raw);
  }
}

let singleton: CognitiveOnnxClassifier | null = null;
export function getCognitiveOnnxClassifier(): CognitiveOnnxClassifier {
  if (!singleton) singleton = new CognitiveOnnxClassifier();
  return singleton;
}
