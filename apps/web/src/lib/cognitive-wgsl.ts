/**
 * fine-tune 済 9-class cognitive classifier の main-thread ラッパー。
 *
 * 処理パイプライン (Python infer-best.py と同一):
 *   1. preprocessText (URL/hashtag/mention 除去)
 *   2. hasJapanese (ja 比率 < 0.5 は分類不能扱い)
 *   3. splitLongPost (120 字以上は 括弧外「。！？!?」で分割)
 *   4. 各 piece を 9-class softmax で推論 (Worker 側で系列を連結して 1 回の GPU 実行にまとめる)
 *   5. 全 piece の確率を mean aggregate
 *   6. none を除いた 8 class を normalizeCognitive で 0-100 にリスケール
 *
 * 推論は cognitive-wgsl.worker.ts の手書き WGSL (WebGPU)。onnxruntime は使わない
 * (ORT の wasm memory が縮まず iOS Safari が落ちるため)。WebGPU が無い環境では
 * CognitiveUnsupportedError を投げ、別経路へのフォールバックはしない。
 *
 * 重み: HF kojira/aozoraquest-cognitive-small の fp32 から scripts/convert-cognitive-wgsl.py で
 * 変換した model.aqw (埋め込み int8 行ごと量子化 + 層 fp16)。252 件 test set で fp32 と
 * top-1 99.6% 一致 (旧 ORT q8 は fp32 と 94.8%)。
 */

import type { CogFunction, CognitiveScores } from '@aozoraquest/core';
import { normalizeCognitive } from '@aozoraquest/core';
import { preprocessText, hasJapanese, splitLongPost } from './japanese-text';

const LABELS_9 = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe', 'none'] as const;
const COGNITIVE_8: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

/** worker への 1 メッセージあたりの最大 piece 数 (進捗通知の粒度)。 */
const DEFAULT_BATCH_SIZE = 32;

/** WebGPU が使えない端末/ブラウザ。UI はこの message をそのまま表示する。 */
export class CognitiveUnsupportedError extends Error {
  constructor() {
    super('この端末/ブラウザは WebGPU に対応していないため、気質の分析ができません (iOS 26 以降の Safari、または最新の Chrome / Edge が必要です)');
    this.name = 'CognitiveUnsupportedError';
  }
}

interface Pending { resolve: (v: number[][]) => void; reject: (e: Error) => void }

function workerError(m: { code?: string; error?: unknown }): Error {
  if (m.code === 'webgpu-unsupported') return new CognitiveUnsupportedError();
  return new Error(String(m.error));
}

export class CognitiveWgslClassifier {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 0;

  /** modelUrl は parity 計測などでローカルの model.aqw を指すときだけ渡す。 */
  async init(modelUrl?: string): Promise<void> {
    if (this.ready) return this.ready;
    const worker = new Worker(new URL('./cognitive-wgsl.worker.ts', import.meta.url), { type: 'module' });
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
    if (!m.id) return;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.type === 'result-batch') p.resolve(m.scoresList as number[][]);
    else if (m.type === 'error') p.reject(workerError(m));
  }

  /**
   * 複数 text の 9-class softmax 確率 (LABELS_9 順) を返す。texts の順序と返り値の順序は保たれる。
   * texts.length が batchSize を超えた場合は chunk に分けて worker に投げ、結果を結合して返す。
   */
  async classifyRawBatch(
    texts: string[],
    batchSize: number = DEFAULT_BATCH_SIZE,
    timeoutMs = 60000,
  ): Promise<number[][]> {
    await this.init();
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const part = await this.sendBatch(texts.slice(start, start + batchSize), timeoutMs);
      out.push(...part);
    }
    return out;
  }

  private sendBatch(texts: string[], timeoutMs: number): Promise<number[][]> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('cognitive classifier disposed'));
    const id = String(this.nextId++);
    return new Promise<number[][]>((resolve, reject) => {
      const to = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cognitive batch timeout ${timeoutMs}ms (${texts.length} texts)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(to); resolve(v); },
        reject: (e) => { clearTimeout(to); reject(e); },
      });
      worker.postMessage({ type: 'classify-batch', id, texts });
    });
  }

  /** GPU buffer を destroy してから Worker を terminate する。 */
  dispose() {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) p.reject(new Error('cognitive classifier disposed'));
    this.pending.clear();
    if (!worker) return;
    const kill = setTimeout(() => worker.terminate(), 2000);
    worker.addEventListener('message', (ev) => {
      if (ev.data?.type === 'disposed') { clearTimeout(kill); worker.terminate(); }
    });
    worker.postMessage({ type: 'dispose' });
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
      if (e instanceof CognitiveUnsupportedError) throw e; // UI に非対応を表示させる
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
      // 失敗 (WebGPU 非対応・GPU device 喪失など) は握りつぶさず呼び出し側へ返す。
      // 別モデルへのフォールバックはしない (diagnosis-flow がエラーとして表示する)。
      const scoresList = await this.classifyRawBatch(chunk, batchSize);
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

let singleton: CognitiveWgslClassifier | null = null;
export function getCognitiveClassifier(): CognitiveWgslClassifier {
  if (!singleton) singleton = new CognitiveWgslClassifier();
  return singleton;
}

/** GPU buffer を destroy し Worker を terminate する。次回 getCognitiveClassifier() で作り直す。 */
export function disposeCognitiveClassifier(): void {
  if (!singleton) return;
  try {
    singleton.dispose();
  } catch {
    /* no-op */
  }
  singleton = null;
}
