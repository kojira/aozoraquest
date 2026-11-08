/**
 * 声のファイル (tts-assets) を Cache Storage `tts-v1` 越しに読む (D-TTS-001)。
 * sha256 が合ったものだけを入れる。壊れたキャッシュは消して取り直す。
 * allowNetwork: false は「導入済みのはず」の読み込み (キャッシュだけを読む)。
 */
import type { TtsAsset } from './tts-assets';

export interface TtsCacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

/** キャッシュに無く、取得も許されていない (ブラウザに消された)。 */
export class TtsNotCachedError extends Error {
  constructor(url: string) { super(`tts not cached (${url})`); this.name = 'TtsNotCachedError'; }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verified(buf: ArrayBuffer, a: TtsAsset): Promise<boolean> {
  return buf.byteLength === a.bytes && await sha256Hex(buf) === a.sha256;
}

/** body を読みながら届いた byte 数を onBytes に渡す。宣言より大きければ打ち切る。 */
async function readBody(res: Response, a: TtsAsset, onBytes?: (n: number) => void): Promise<ArrayBuffer> {
  if (!res.body) { const b = await res.arrayBuffer(); onBytes?.(b.byteLength); return b; }
  const out = new Uint8Array(a.bytes);
  const reader = res.body.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.byteLength > a.bytes) { await reader.cancel().catch(() => undefined); throw new Error(`tts file mismatch (${a.url})`); }
    out.set(value, n);
    n += value.byteLength;
    onBytes?.(n);
  }
  return n === a.bytes ? out.buffer : out.buffer.slice(0, n);
}

export async function fetchTtsAsset(a: TtsAsset, cache: TtsCacheLike | null, o: { allowNetwork: boolean; onBytes?: (n: number) => void }): Promise<ArrayBuffer> {
  const hit = await cache?.match(a.url).catch(() => undefined);
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (await verified(buf, a)) { o.onBytes?.(a.bytes); return buf; }
    await cache?.delete(a.url).catch(() => undefined);
  }
  if (!o.allowNetwork) throw new TtsNotCachedError(a.url);
  const res = await fetch(a.url);
  if (!res.ok) throw new Error(`tts fetch failed: HTTP ${res.status} (${a.url})`);
  const buf = await readBody(res, a, o.onBytes);
  if (!(await verified(buf, a))) throw new Error(`tts file mismatch (${a.url})`);
  await cache?.put(a.url, new Response(buf.slice(0)));
  return buf;
}
