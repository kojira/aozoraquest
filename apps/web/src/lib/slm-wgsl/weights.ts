/**
 * 自前 WGSL エンジンの重み配布と GPU への流し込み (LFM2.5-1.2B-JP と sarashina2.2-0.5b)。
 *
 * HF に 32MB の part として置き (header.json の parts に bytes と sha256)、part ごとに
 * fetch → sha256 照合 → Cache API へ保存 → 該当 tensor の GPU buffer へ書く。CPU に持つのは 1 part ぶんだけ。
 * URL は HF の commit で固定する (main を差しかえても端末のキャッシュと食い違わない)。
 * どのモデルを読むかは SlmWeightsSource (URL・header の sha256・キャッシュ名・arch) で渡す。
 */

/** 配布元 1 つぶん。arch は header.json の config.arch と一致しなければ読まない。 */
export interface SlmWeightsSource { baseUrl: string; headerSha256: string; cacheName: string; arch: 'lfm2' | 'llama' }

const HF_REPO = 'https://huggingface.co/kojira/aozoraquest-cognitive-small/resolve';

/** LFM2.5-1.2B-JP-202606 (int4、HF rev 52b8b44 を変換)。カードの文と投稿の翻訳に使う。 */
export const SLM_HF_COMMIT = '2469a7cb1621a4633f258b66558bd39aa0e50b00';
export const SLM_BASE_URL = `${HF_REPO}/${SLM_HF_COMMIT}/wgsl/lfm2.5-1.2b-jp-q4`;
/** header.json の sha256 (e2e の model-urls で HF の X-Linked-Etag と照合する)。 */
export const SLM_HEADER_SHA256 = '6c83271516b3707fb4847c16f72d8f7175842721601a4c1a5ac567a62396d481';
/** part 合計 (重み本体)。tokenizer.json は別。 */
export const SLM_TOTAL_BYTES = 658_762_752;
export const SLM_TOKENIZER_BYTES = 4_733_020;
export const SLM_CACHE_NAME = 'slm-wgsl-v1';
/** LFM Open License v1.0 の原文 (HF に重みと一緒に置いた写し)。privacy のクレジットからリンクする。 */
export const SLM_LICENSE_URL = `${SLM_BASE_URL}/LICENSE`;
export const SLM_SOURCE: SlmWeightsSource = { baseUrl: SLM_BASE_URL, headerSha256: SLM_HEADER_SHA256, cacheName: SLM_CACHE_NAME, arch: 'lfm2' };

/** sarashina2.2-0.5b (翻訳専用。LFM へ移した後に削る)。 */
export const SARASHINA_HF_COMMIT = '5770ffdd050e24172b17f5bce878eccd8c731aa6';
export const SARASHINA_BASE_URL = `${HF_REPO}/${SARASHINA_HF_COMMIT}/wgsl/sarashina2.2-0.5b-q4`;
export const SARASHINA_HEADER_SHA256 = 'c6437f10c811287be4f39a1991a96174e0ec0109cb01d74957cc6ccef86810a1';
/** part 合計 (重み本体)。tokenizer.json は別。 */
export const SARASHINA_TOTAL_BYTES = 446_305_280;
export const SARASHINA_TOKENIZER_BYTES = 3_650_343;
export const SARASHINA_CACHE_NAME = 'sarashina-wgsl-v1';
export const SARASHINA_SOURCE: SlmWeightsSource = {
  baseUrl: SARASHINA_BASE_URL, headerSha256: SARASHINA_HEADER_SHA256, cacheName: SARASHINA_CACHE_NAME, arch: 'llama',
};

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
  /** 'full' = attention、'conv' = LFM2 の short conv。 */
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
  /** LFM2: attention の q/k に head ごとの RMSNorm を掛ける。 */
  qkNorm?: boolean;
  /** LFM2: LM head を embed と共用する (lm_head tensor は持たない)。 */
  tied?: boolean;
  /** LFM2: short conv の幅。 */
  convK?: number;
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

async function openCache(cacheName: string): Promise<Cache | null> {
  try {
    return await caches.open(cacheName);
  } catch {
    return null; // Cache API 不可 (private mode 等) は毎回取得
  }
}

/** 端末のキャッシュに無く、ネットワークからの取得も許されていない (翻訳時の読み込みで導入済みのキャッシュが欠けていた)。 */
export class SlmNotCachedError extends Error {
  constructor(file: string) {
    super(`slm not cached (${file})`);
    this.name = 'SlmNotCachedError';
  }
}

/** 取得したファイルを Cache API に書けなかった (端末の空きが足りない)。導入は失敗にする (中途半端なキャッシュは main 側が消す)。 */
export class SlmCacheWriteError extends Error {
  constructor(file: string, cause: unknown) {
    super(`slm cache write failed (${file}): ${String((cause as Error)?.message ?? cause)}`);
    this.name = 'SlmCacheWriteError';
  }
}

/**
 * allowNetwork: false なら Cache API だけを読み、無ければ取得せず SlmNotCachedError。ネットワークから取るのは導入 (召喚の儀式) だけ。
 * onHeartbeat: ダウンロード中に byte が届いている間、最大 HEARTBEAT_MS に 1 回、そのファイルで届いた byte 数を渡して呼ぶ
 * (低速回線で 32MB の part を待つ間も停止監視を進め、進捗を出す。Refs #779)。
 */
export interface SlmFetchOptions { allowNetwork: boolean; onHeartbeat?: (bytesRead: number) => void }

const HEARTBEAT_MS = 1000;

/** res.body を chunk ごとに読み、byte が届くたびに (間引いて) onHeartbeat を呼ぶ。bytes を超えたら打ち切る。 */
async function readBody(res: Response, bytes: number, file: string, onHeartbeat?: (bytesRead: number) => void): Promise<ArrayBuffer> {
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
      throw new Error(`slm file mismatch (${file})`);
    }
    out.set(value, n);
    n += value.byteLength;
    if (onHeartbeat && Date.now() - last >= HEARTBEAT_MS) { last = Date.now(); onHeartbeat(n); }
  }
  return n === bytes ? out.buffer : out.buffer.slice(0, n);
}

/** url のファイルをキャッシュ優先で読み、sha256 が合わなければ throw する (壊れたキャッシュは消す)。 */
export async function fetchVerified(
  source: SlmWeightsSource,
  file: string,
  entry: { bytes: number; sha256: string },
  opts: SlmFetchOptions,
): Promise<ArrayBuffer> {
  const url = `${source.baseUrl}/${file}`;
  const cache = await openCache(source.cacheName);
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (buf.byteLength === entry.bytes && await sha256Hex(buf) === entry.sha256) return buf;
    await cache?.delete(url).catch(() => undefined);
  }
  if (!opts.allowNetwork) throw new SlmNotCachedError(file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`slm fetch failed: HTTP ${res.status} (${file})`);
  const buf = await readBody(res, entry.bytes, file, opts.onHeartbeat);
  if (buf.byteLength !== entry.bytes || await sha256Hex(buf) !== entry.sha256) {
    throw new Error(`slm file mismatch (${file})`);
  }
  if (cache) {
    try {
      await cache.put(url, new Response(buf));
    } catch (e) {
      throw new SlmCacheWriteError(file, e);
    }
  }
  return buf;
}

export async function fetchHeader(source: SlmWeightsSource, opts: SlmFetchOptions): Promise<SlmHeader> {
  const url = `${source.baseUrl}/header.json`;
  const cache = await openCache(source.cacheName);
  let res = await cache?.match(url).catch(() => undefined);
  let text = res ? await res.text() : null;
  if (text === null || await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer) !== source.headerSha256) {
    if (!opts.allowNetwork) throw new SlmNotCachedError('header.json');
    res = await fetch(url);
    if (!res.ok) throw new Error(`slm header fetch failed: HTTP ${res.status}`);
    text = await res.text();
    if (await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer) !== source.headerSha256) {
      throw new Error('slm header mismatch');
    }
    await cache?.put(url, new Response(text)).catch(() => undefined);
  }
  const h = JSON.parse(text) as SlmHeader;
  if (h.format !== 'slw1' || h.config.arch !== source.arch) throw new Error(`slm header: unexpected ${h.format}/${h.config.arch}`);
  return h;
}

/** 重み part とトークナイザがすべて端末のキャッシュにあるか (初回ダウンロードの演出を出すかの判定)。 */
export async function isSlmCached(source: SlmWeightsSource): Promise<boolean> {
  try {
    if (!(await caches.has(source.cacheName))) return false;
    const cache = await caches.open(source.cacheName);
    const keys = new Set((await cache.keys()).map((r) => r.url));
    const header = keys.has(`${source.baseUrl}/header.json`) ? await fetchHeader(source, { allowNetwork: false }) : null;
    if (!header) return false;
    return [...header.parts, header.tokenizer].every((p) => keys.has(`${source.baseUrl}/${p.file}`));
  } catch {
    return false;
  }
}

/**
 * part を順に読み、segments (ファイル順・4 byte 境界) に従って GPU buffer へ書く。
 * part の境界をまたぐ segment は part ごとに分けて書く。
 * onProgress には読み終えた byte 数 (ダウンロード中の part は届いた分まで) と part の合計を渡す。
 */
export async function streamWeights(
  device: GPUDevice,
  source: SlmWeightsSource,
  header: SlmHeader,
  segments: WeightSegment[],
  onProgress: (loaded: number, total: number) => void,
  opts: SlmFetchOptions,
): Promise<void> {
  let partStart = 0;
  let si = 0;
  for (let p = 0; p < header.parts.length; p++) {
    const part = header.parts[p]!;
    const start = partStart;
    const buf = await fetchVerified(source, part.file, part, { ...opts, onHeartbeat: (n) => onProgress(start + n, header.totalBytes) });
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
    onProgress(partEnd, header.totalBytes);
  }
  if (si < segments.length) throw new Error('slm weights ended early');
}
