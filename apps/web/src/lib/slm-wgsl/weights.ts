/**
 * sarashina2.2-0.5b (int4 WGSL) の重み配布と GPU への流し込み。
 *
 * HF に 32MB の part として置き (header.json の parts に bytes と sha256)、part ごとに
 * fetch → sha256 照合 → Cache API へ保存 → 該当 tensor の GPU buffer へ書く。CPU に持つのは 1 part ぶんだけ。
 * URL は HF の commit で固定する (main を差しかえても端末のキャッシュと食い違わない)。
 */

export const SARASHINA_HF_COMMIT = '5770ffdd050e24172b17f5bce878eccd8c731aa6';
export const SARASHINA_BASE_URL =
  `https://huggingface.co/kojira/aozoraquest-cognitive-small/resolve/${SARASHINA_HF_COMMIT}/wgsl/sarashina2.2-0.5b-q4`;
/** header.json の sha256 (e2e の model-urls で HF の X-Linked-Etag と照合する)。 */
export const SARASHINA_HEADER_SHA256 = 'c6437f10c811287be4f39a1991a96174e0ec0109cb01d74957cc6ccef86810a1';
/** part 合計 (重み本体)。tokenizer.json (約 3.6MB) は別。 */
export const SARASHINA_TOTAL_BYTES = 446_305_280;
export const SARASHINA_CACHE_NAME = 'sarashina-wgsl-v1';

export interface SlmTensorEntry {
  name: string;
  kind: 'q4' | 'f32';
  shape: number[];
  offset: number;
  bytes?: number;
  qBytes?: number;
  sBytes?: number;
}

export interface SlmFileEntry { file: string; bytes: number; sha256: string }

export interface SlmConfig {
  arch: string;
  layers: string[];
  hidden: number;
  inter: number;
  vocab: number;
  heads: number;
  kvHeads: number;
  headDim: number;
  ropeTheta: number;
  eps: number;
  eos: number[];
  maxCtx: number;
}

export interface SlmHeader {
  format: 'slw1';
  config: SlmConfig;
  tensors: SlmTensorEntry[];
  parts: SlmFileEntry[];
  totalBytes: number;
  tokenizer: SlmFileEntry;
}

/** ファイル上の byte 範囲 [start, end) を buf の off から書く。 */
export interface WeightSegment { start: number; end: number; buf: GPUBuffer; off: number }

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(SARASHINA_CACHE_NAME);
  } catch {
    return null; // Cache API 不可 (private mode 等) は毎回取得
  }
}

/** 端末のキャッシュに無く、ネットワークからの取得も許されていない (翻訳時の読み込みで導入済みのキャッシュが欠けていた)。 */
export class SarashinaNotCachedError extends Error {
  constructor(file: string) {
    super(`sarashina not cached (${file})`);
    this.name = 'SarashinaNotCachedError';
  }
}

/**
 * allowNetwork: false なら Cache API だけを読み、無ければ取得せず SarashinaNotCachedError。ネットワークから取るのは導入 (召喚の儀式) だけ。
 * onHeartbeat: ダウンロード中に byte が届いている間、最大 HEARTBEAT_MS に 1 回呼ぶ (低速回線で 32MB の part を待つ間も停止監視を進める。Refs #779)。
 */
export interface SarashinaFetchOptions { allowNetwork: boolean; onHeartbeat?: () => void }

const HEARTBEAT_MS = 1000;

/** res.body を chunk ごとに読み、byte が届くたびに (間引いて) onHeartbeat を呼ぶ。bytes を超えたら打ち切る。 */
async function readBody(res: Response, bytes: number, file: string, onHeartbeat?: () => void): Promise<ArrayBuffer> {
  if (!res.body) return res.arrayBuffer();
  const out = new Uint8Array(bytes);
  const reader = res.body.getReader();
  let n = 0;
  let last = Date.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.byteLength > bytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`sarashina file mismatch (${file})`);
    }
    out.set(value, n);
    n += value.byteLength;
    if (onHeartbeat && Date.now() - last >= HEARTBEAT_MS) { last = Date.now(); onHeartbeat(); }
  }
  return n === bytes ? out.buffer : out.buffer.slice(0, n);
}

/** url のファイルをキャッシュ優先で読み、sha256 が合わなければ throw する (壊れたキャッシュは消す)。 */
export async function fetchVerified(url: string, entry: { bytes: number; sha256: string }, opts: SarashinaFetchOptions): Promise<ArrayBuffer> {
  const cache = await openCache();
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (buf.byteLength === entry.bytes && await sha256Hex(buf) === entry.sha256) return buf;
    await cache?.delete(url).catch(() => undefined);
  }
  if (!opts.allowNetwork) throw new SarashinaNotCachedError(url.split('/').pop() ?? url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sarashina fetch failed: HTTP ${res.status} (${url.split('/').pop()})`);
  const buf = await readBody(res, entry.bytes, url.split('/').pop() ?? url, opts.onHeartbeat);
  if (buf.byteLength !== entry.bytes || await sha256Hex(buf) !== entry.sha256) {
    throw new Error(`sarashina file mismatch (${url.split('/').pop()})`);
  }
  await cache?.put(url, new Response(buf)).catch((e: unknown) => console.warn('[slm] cache put failed', e));
  return buf;
}

export async function fetchHeader(opts: SarashinaFetchOptions): Promise<SlmHeader> {
  const url = `${SARASHINA_BASE_URL}/header.json`;
  const cache = await openCache();
  let res = await cache?.match(url).catch(() => undefined);
  let text = res ? await res.text() : null;
  if (text === null || await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer) !== SARASHINA_HEADER_SHA256) {
    if (!opts.allowNetwork) throw new SarashinaNotCachedError('header.json');
    res = await fetch(url);
    if (!res.ok) throw new Error(`sarashina header fetch failed: HTTP ${res.status}`);
    text = await res.text();
    if (await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer) !== SARASHINA_HEADER_SHA256) {
      throw new Error('sarashina header mismatch');
    }
    await cache?.put(url, new Response(text)).catch(() => undefined);
  }
  const h = JSON.parse(text) as SlmHeader;
  if (h.format !== 'slw1' || h.config.arch !== 'llama') throw new Error(`sarashina header: unexpected ${h.format}/${h.config.arch}`);
  return h;
}

/** 重み part とトークナイザがすべて端末のキャッシュにあるか (初回ダウンロードの演出を出すかの判定)。 */
export async function isSarashinaCached(): Promise<boolean> {
  try {
    if (!(await caches.has(SARASHINA_CACHE_NAME))) return false;
    const cache = await caches.open(SARASHINA_CACHE_NAME);
    const keys = new Set((await cache.keys()).map((r) => r.url));
    const header = keys.has(`${SARASHINA_BASE_URL}/header.json`) ? await fetchHeader({ allowNetwork: false }) : null;
    if (!header) return false;
    return [...header.parts, header.tokenizer].every((p) => keys.has(`${SARASHINA_BASE_URL}/${p.file}`));
  } catch {
    return false;
  }
}

/**
 * part を順に読み、segments (ファイル順・4 byte 境界) に従って GPU buffer へ書く。
 * part の境界をまたぐ segment は part ごとに分けて書く。
 */
export async function streamWeights(
  device: GPUDevice,
  baseUrl: string,
  header: SlmHeader,
  segments: WeightSegment[],
  onPartDone: (done: number, total: number) => void,
  opts: SarashinaFetchOptions,
): Promise<void> {
  let partStart = 0;
  let si = 0;
  for (let p = 0; p < header.parts.length; p++) {
    const part = header.parts[p]!;
    const buf = await fetchVerified(`${baseUrl}/${part.file}`, part, opts);
    const partEnd = partStart + part.bytes;
    while (si < segments.length && segments[si]!.start < partEnd) {
      const s = segments[si]!;
      const a = Math.max(s.start, partStart);
      const b = Math.min(s.end, partEnd);
      if (b > a) device.queue.writeBuffer(s.buf, s.off + (a - s.start), buf, a - partStart, b - a);
      if (s.end <= partEnd) si++;
      else break;
    }
    partStart = partEnd;
    await device.queue.onSubmittedWorkDone(); // 次の part を読む前に GPU 側のコピーを終わらせて CPU のメモリを返す
    onPartDone(p + 1, header.parts.length);
  }
  if (si < segments.length) throw new Error('sarashina weights ended early');
}
