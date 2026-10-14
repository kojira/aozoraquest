/**
 * model.aqw (scripts/convert-cognitive-wgsl.py が出力) を fetch しながら GPU buffer へ流し込む。
 *
 * CPU 側に全体のコピーを持たない: 受信 chunk をそのまま queue.writeBuffer で該当 tensor の
 * buffer へ書き、4 byte 境界に満たない端数 (最大 3 byte) だけを次の chunk へ持ち越す。
 * ファイルは Cache API に保存し、2 回目以降はキャッシュから同じ経路でストリームする。
 */

import { BUFFER_USAGE } from './gpu-flags';

export const COGNITIVE_WGSL_MODEL_URL =
  'https://huggingface.co/kojira/aozoraquest-cognitive-small/resolve/main/wgsl/model.aqw';
/** HF に置く model.aqw の sha256 (e2e の model-urls で HF の X-Linked-Etag と照合する)。 */
export const COGNITIVE_WGSL_MODEL_SHA256 = 'b9a3a70d20ed80401eaac6d5446437b8831c430efdfd5e647cd0dae536a698ad';
export const COGNITIVE_WGSL_MODEL_BYTES = 47_764_164;
/**
 * Ruri-v3-30m 埋め込み (cl-nagoya/ruri-v3-30m, Apache-2.0) を sirasagi62/ruri-v3-30m-ONNX の fp32 から
 * scripts/convert-cognitive-wgsl.py で変換したもの (head = mean-pool)。
 */
export const RURI_WGSL_MODEL_URL =
  'https://huggingface.co/kojira/aozoraquest-cognitive-small/resolve/main/wgsl/ruri-v3-30m.aqw';
export const RURI_WGSL_MODEL_SHA256 = 'd0e9bcb2774b5b9ea6f55b1ea8036933516d0595fcb79064d76526ab6e72e865';
export const RURI_WGSL_MODEL_BYTES = 47_622_472;
const CACHE_NAME = 'cognitive-wgsl-v1';

export interface AqwTensorEntry {
  name: string;
  dtype: 'f32' | 'f16' | 'i8';
  shape: number[];
  offset: number;
  bytes: number;
}

/** 出力 head。省略時 (cognitive-small の model.aqw) は classifier。 */
export type AqwHead = 'classifier' | 'mean-pool';

export interface AqwHeader {
  format: 'aqw1';
  config: { labels: string[]; vocab: number; head?: AqwHead };
  tensors: AqwTensorEntry[];
}

export type GpuWeights = Map<string, GPUBuffer>;

export type WeightProgress = (loaded: number, total: number) => void;

/** stream から必要なだけ byte を読み出す小さなリーダ (header 解析用)。 */
class ChunkReader {
  private buf = new Uint8Array(0);
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async take(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) {
      const { done, value } = await this.reader.read();
      if (done) throw new Error('cognitive model file ended early');
      const merged = new Uint8Array(this.buf.length + value.length);
      merged.set(this.buf);
      merged.set(value, this.buf.length);
      this.buf = merged;
    }
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  /** header 読み出し後に残った先読み分を返して空にする。 */
  drain(): Uint8Array {
    const out = this.buf;
    this.buf = new Uint8Array(0);
    return out;
  }

  read() { return this.reader.read(); }
}

async function openModelStream(url: string): Promise<Response> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch {
    cache = null; // Cache API 不可 (private mode 等) はキャッシュなしで続行
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cognitive model fetch failed: HTTP ${res.status}`);
  if (!cache) return res;
  await cache.put(url, res);
  const stored = await cache.match(url);
  if (!stored) throw new Error('cognitive model cache write failed');
  return stored;
}

export async function deleteCachedModel(url: string): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(url);
  } catch {
    /* no-op */
  }
}

/**
 * onnxruntime 時代に transformers.js が transformers-cache へ保存した .onnx (cognitive / Ruri 各約 37MB) と
 * ORT の .wasm はもう読まないので消す。tokenizer.json などは残す (cognitive-wgsl/tokenizer.ts が同じ cache を使う)。
 */
export async function pruneOrtCache(): Promise<void> {
  try {
    for (const name of await caches.keys()) {
      if (!name.includes('transformers')) continue;
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        if (req.url.endsWith('.onnx') || req.url.endsWith('.wasm')) await cache.delete(req);
      }
    }
  } catch (e) {
    console.warn('[wgsl] ORT cache prune failed', e);
  }
}

/**
 * url の model.aqw を読み、tensor ごとの GPU storage buffer を作って返す。
 * 途中で失敗したら作りかけの buffer を destroy して throw する。
 */
export async function loadWeights(
  device: GPUDevice,
  url: string,
  onProgress?: WeightProgress,
): Promise<{ header: AqwHeader; weights: GpuWeights }> {
  const res = await openModelStream(url);
  if (!res.body) throw new Error('cognitive model response has no body');
  const reader = new ChunkReader(res.body.getReader());
  const weights: GpuWeights = new Map();
  try {
    const magic = new TextDecoder().decode(await reader.take(4));
    if (magic !== 'AQW1') throw new Error(`cognitive model: bad magic "${magic}"`);
    const headerLen = new DataView((await reader.take(4)).buffer).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(await reader.take(headerLen))) as AqwHeader;
    if (header.format !== 'aqw1') throw new Error(`cognitive model: unknown format ${header.format}`);
    const total = header.tensors.reduce((s, t) => s + t.bytes, 0);

    for (const t of header.tensors) {
      weights.set(t.name, device.createBuffer({
        label: `cognitive:${t.name}`,
        size: t.bytes,
        usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST,
      }));
    }

    let tensorIdx = 0;
    let written = 0; // 現 tensor 内に書いた byte 数
    let loaded = 0;
    let carry = new Uint8Array(0);
    const writeChunk = (chunk: Uint8Array) => {
      let data = chunk;
      if (carry.length > 0) {
        const merged = new Uint8Array(carry.length + chunk.length);
        merged.set(carry);
        merged.set(chunk, carry.length);
        data = merged;
        carry = new Uint8Array(0);
      }
      let pos = 0;
      while (pos < data.length && tensorIdx < header.tensors.length) {
        const t = header.tensors[tensorIdx]!;
        const want = t.bytes - written;
        let n = Math.min(want, data.length - pos);
        if (n < want) n -= n % 4; // writeBuffer は 4 byte 単位
        if (n === 0) break;
        device.queue.writeBuffer(weights.get(t.name)!, written, data, pos, n);
        written += n;
        pos += n;
        if (written === t.bytes) { tensorIdx++; written = 0; }
      }
      if (pos < data.length) {
        if (tensorIdx >= header.tensors.length) throw new Error('cognitive model: trailing bytes');
        carry = data.slice(pos);
      }
      loaded += chunk.length;
      onProgress?.(loaded, total);
    };

    const rest = reader.drain();
    if (rest.length > 0) writeChunk(rest);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      writeChunk(value);
    }
    if (tensorIdx !== header.tensors.length || carry.length > 0) {
      throw new Error(`cognitive model truncated (${loaded}/${total} bytes)`);
    }
    return { header, weights };
  } catch (e) {
    for (const b of weights.values()) b.destroy();
    throw e;
  }
}
