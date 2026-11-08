import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchTtsAsset, TtsNotCachedError } from './tts-cache';

// D-TTS-001: the voice files are kept in Cache Storage `tts-v1`, only after their sha256 matches.
const bytes = new TextEncoder().encode('voice-bytes');
const SHA = 'b3a8cd1ee1cd5d1d1bd7d4ad2d2e88a8b1fa3e1f0dd7d6e5bfe2d5bc0a3c49c6';
async function sha(b: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function memoryCache() {
  const m = new Map<string, ArrayBuffer>();
  return {
    m,
    match: async (u: string) => (m.has(u) ? new Response(m.get(u)!.slice(0)) : undefined),
    put: async (u: string, r: Response) => { m.set(u, await r.arrayBuffer()); },
    delete: async (u: string) => m.delete(u),
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('fetchTtsAsset', () => {
  test('downloads with progress, checks sha256, then stores it; next time it is read from the cache', async () => {
    const asset = { url: 'https://x.test/v.ztm', bytes: bytes.length, sha256: await sha(bytes) };
    const cache = memoryCache();
    const fetchMock = vi.fn(async () => new Response(bytes.slice(0)));
    vi.stubGlobal('fetch', fetchMock);
    const seen: number[] = [];
    const buf = await fetchTtsAsset(asset, cache, { allowNetwork: true, onBytes: (n) => seen.push(n) });
    expect(new Uint8Array(buf)).toEqual(bytes);
    expect(seen.at(-1)).toBe(bytes.length);
    expect(cache.m.has(asset.url)).toBe(true);
    await fetchTtsAsset(asset, cache, { allowNetwork: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test('a wrong file is rejected and not cached; without network a missing file is TtsNotCachedError', async () => {
    const asset = { url: 'https://x.test/v.ztm', bytes: bytes.length, sha256: SHA };
    const cache = memoryCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes.slice(0))));
    await expect(fetchTtsAsset(asset, cache, { allowNetwork: true })).rejects.toThrow('mismatch');
    expect(cache.m.size).toBe(0);
    await expect(fetchTtsAsset(asset, cache, { allowNetwork: false })).rejects.toBeInstanceOf(TtsNotCachedError);
  });
});
