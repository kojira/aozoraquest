/**
 * fine-tune 済 9-class cognitive classifier の main-thread ラッパー。
 *
 * 処理パイプライン (Python infer-best.py と同一):
 *   1. preprocessText (URL/hashtag/mention 除去)
 *   2. hasJapanese (ja 比率 < 0.5 は分類不能扱い)
 *   3. splitLongPost (120 字以上は 括弧外「。！？!?」で分割)
 *   4. 各 piece を 9-class softmax で推論 (バッチ化: pipeline に複数 text を
 *      一気に渡して 1 回の sess.run でまとめて処理)
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

import { isIosSafari, isLowEndDevice } from './device';

/** batch 推論の 1 call あたり最大件数。GPU メモリと padding 損失のバランス。 */
const DEFAULT_BATCH_SIZE = 16;

type Pending =
  | { kind: 'single'; resolve: (v: number[]) => void; reject: (e: Error) => void }
  | { kind: 'batch'; resolve: (v: number[][]) => void; reject: (e: Error) => void };

const MODEL_LARGE = 'kojira/aozoraquest-cognitive';
const MODEL_SMALL = 'kojira/aozoraquest-cognitive-small';

function pickModelName(): string {
  return isLowEndDevice() ? MODEL_SMALL : MODEL_LARGE;
}

export class CognitiveOnnxClassifier {
  private worker: Worker | null = null;
  private ready: Promise<{ backend: CognitiveBackend; dtype: CognitiveDtype }> | null = null;
  private pending = new Map<string, Pending>();
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
      this.worker!.postMessage({
        type: 'init',
        modelName: pickModelName(),
        forceWasm: isIosSafari(),
      });
    });
    return this.ready;
  }

  getInfo(): { backend: CognitiveBackend; dtype: CognitiveDtype } | null { return this.info; }

  private onMessage(ev: MessageEvent) {
    const m = ev.data;
    if (m.type === 'result' && m.id) {
      const p = this.pending.get(m.id);
      if (p && p.kind === 'single') { this.pending.delete(m.id); p.resolve(m.scores as number[]); }
      return;
    }
    if (m.type === 'result-batch' && m.id) {
      const p = this.pending.get(m.id);
      if (p && p.kind === 'batch') { this.pending.delete(m.id); p.resolve(m.scoresList as number[][]); }
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
        kind: 'single',
        resolve: (v) => { clearTimeout(to); resolve(v); },
        reject: (e) => { clearTimeout(to); reject(e); },
      });
      this.worker!.postMessage({ type: 'classify', id, text });
    });
  }

  /**
   * 複数 text をバッチ推論 (pipeline の 1 回 sess.run)。
   * 呼び出し側でまとめられる分だけまとめると GPU / WASM の per-call オーバヘッドが
   * amortize されて 5-10x 高速。texts の順序と返り値の順序は保たれる。
   *
   * texts.length が batchSize を超えた場合は内部で chunk に分けて worker に投げ直し、
   * 結果を結合して返す。
   */
  async classifyRawBatch(
    texts: string[],
    batchSize: number = DEFAULT_BATCH_SIZE,
    timeoutMs = 60000,
  ): Promise<number[][]> {
    if (!this.worker) await this.init();
    await this.ready;
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const chunk = texts.slice(start, start + batchSize);
      const part = await this.sendBatch(chunk, timeoutMs);
      out.push(...part);
    }
    return out;
  }

  private sendBatch(texts: string[], timeoutMs: number): Promise<number[][]> {
    const id = String(this.nextId++);
    return new Promise<number[][]>((resolve, reject) => {
      const to = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cognitive-onnx batch timeout ${timeoutMs}ms (${texts.length} texts)`));
      }, timeoutMs);
      this.pending.set(id, {
        kind: 'batch',
        resolve: (v) => { clearTimeout(to); resolve(v); },
        reject: (e) => { clearTimeout(to); reject(e); },
      });
      this.worker!.postMessage({ type: 'classify-batch', id, texts });
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.info = null;
  }

  /** 本番パイプライン: text → preprocess → split → piece 群を batch 推論 → mean → 8-class normalize。 */
  async classifyPost(rawText: string, splitThreshold = 120): Promise<CognitiveScores | null> {
    const pre = preprocessText(rawText);
    if (pre.length < 8) return null;
    if (!hasJapanese(pre)) return null;

    const pieces = splitLongPost(pre, splitThreshold);
    let perPiece: number[][] = [];
    try {
      perPiece = await this.classifyRawBatch(pieces);
    } catch (e) {
      console.warn('[cognitive] batch classify failed, skipping post', e);
      return null;
    }
    if (perPiece.length === 0) return null;

    const nDim = LABELS_9.length;
    const avg = new Array<number>(nDim).fill(0);
    for (const s of perPiece) {
      for (let i = 0; i < nDim; i++) avg[i]! += s[i]! / perPiece.length;
    }

    const raw = {} as CognitiveScores;
    for (const fn of COGNITIVE_8) {
      const idx = LABELS_9.indexOf(fn);
      raw[fn] = avg[idx] ?? 0;
    }
    return normalizeCognitive(raw);
  }

  /**
   * N 個の post (raw text) を丸ごと分類する本命 API。
   * 全 post の piece を flat にまとめて batch 推論し、各 post の平均スコアに
   * 戻して CognitiveScores 配列を返す。個別 classifyPost を N 回呼ぶ場合に比べて
   * per-call オーバヘッドが大幅に削減される (診断 1 人 150 posts で 5-10x 高速)。
   *
   * ただし各 post の CognitiveScores はこの関数の中で normalize されるので、
   * 上流で時間軸重み付けされる診断 (diagnose-from-per-post-scores) の入力としては
   * そのまま使える。
   *
   * null (preprocess で落ちた post) はそのまま null で返す。
   */
  async classifyPosts(
    rawTexts: readonly string[],
    splitThreshold = 120,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Array<CognitiveScores | null>> {
    const N = rawTexts.length;
    // 各 post の piece 列と flat index をマップする
    type PieceOwner = { postIdx: number };
    const pieceTexts: string[] = [];
    const pieceOwners: PieceOwner[] = [];
    const postValid: boolean[] = new Array(N).fill(false);
    for (let i = 0; i < N; i++) {
      const raw = rawTexts[i] ?? '';
      const pre = preprocessText(raw);
      if (pre.length < 8 || !hasJapanese(pre)) continue;
      const pieces = splitLongPost(pre, splitThreshold);
      for (const p of pieces) {
        pieceTexts.push(p);
        pieceOwners.push({ postIdx: i });
      }
      postValid[i] = true;
    }

    // progress: piece 単位で報告する (バッチ終わるごとに done を増やす)
    const results: Array<CognitiveScores | null> = new Array(N).fill(null);
    const nDim = LABELS_9.length;
    const avg: number[][] = Array.from({ length: N }, () => new Array(nDim).fill(0));
    const counts: number[] = new Array(N).fill(0);

    const batchSize = DEFAULT_BATCH_SIZE;
    let processed = 0;
    for (let start = 0; start < pieceTexts.length; start += batchSize) {
      const chunk = pieceTexts.slice(start, start + batchSize);
      const owners = pieceOwners.slice(start, start + batchSize);
      let scoresList: number[][];
      try {
        scoresList = await this.classifyRawBatch(chunk, batchSize);
      } catch (e) {
        console.warn('[cognitive] batch inference failed, skipping chunk', e);
        processed += chunk.length;
        onProgress?.(processed, pieceTexts.length);
        continue;
      }
      for (let k = 0; k < owners.length; k++) {
        const oi = owners[k]!.postIdx;
        const s = scoresList[k];
        if (!s) continue;
        for (let d = 0; d < nDim; d++) avg[oi]![d]! += s[d] ?? 0;
        counts[oi]!++;
      }
      processed += chunk.length;
      onProgress?.(processed, pieceTexts.length);
    }

    for (let i = 0; i < N; i++) {
      if (!postValid[i] || counts[i]! === 0) { results[i] = null; continue; }
      const raw = {} as CognitiveScores;
      for (const fn of COGNITIVE_8) {
        const idx = LABELS_9.indexOf(fn);
        raw[fn] = (avg[i]![idx] ?? 0) / counts[i]!;
      }
      results[i] = normalizeCognitive(raw);
    }
    return results;
  }
}

let singleton: CognitiveOnnxClassifier | null = null;
export function getCognitiveOnnxClassifier(): CognitiveOnnxClassifier {
  if (!singleton) singleton = new CognitiveOnnxClassifier();
  return singleton;
}

/** 診断完了時などに呼ぶ: Worker を terminate して tensor / KV cache を解放。
 *  次回 getCognitiveOnnxClassifier() で新 Worker が立つ。モバイル Safari で
 *  繰り返し診断すると tensor が貯まってクラッシュするので必須。 */
export function disposeCognitiveOnnxClassifier(): void {
  if (!singleton) return;
  try {
    singleton.dispose();
  } catch {
    /* no-op */
  }
  singleton = null;
}
