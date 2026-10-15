import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHeader, fetchVerified, SarashinaNotCachedError, streamWeights, type SlmHeader } from './weights';

/** 翻訳時の読み込み (allowNetwork: false) は、キャッシュが欠けていても fetch を呼ばない (キャッシュ消去後に 430MB を勝手に取り直さない)。 */
function stubCache(files: Record<string, ArrayBuffer>) {
  const cache = {
    match: async (url: string) => (files[url] ? new Response(files[url]) : undefined),
    put: async () => undefined,
    delete: async () => true,
    keys: async () => Object.keys(files).map((u) => new Request(u)),
  };
  vi.stubGlobal('caches', { open: async () => cache, has: async () => Object.keys(files).length > 0 });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const fakeDevice = { queue: { writeBuffer: () => undefined, onSubmittedWorkDone: async () => undefined } } as unknown as GPUDevice;

describe('sarashina weights cache-only load', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('header: throws not-cached without fetching when the cache is empty', async () => {
    stubCache({});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchHeader({ allowNetwork: false })).rejects.toBeInstanceOf(SarashinaNotCachedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parts: streams the cached part, then stops at the missing one without fetching', async () => {
    const part0 = new Uint8Array([1, 2, 3, 4]).buffer;
    const part1 = new Uint8Array([5, 6, 7, 8]).buffer;
    const header = {
      parts: [
        { file: 'part-000.bin', bytes: 4, sha256: await sha256Hex(part0) },
        { file: 'part-001.bin', bytes: 4, sha256: await sha256Hex(part1) },
      ],
    } as SlmHeader;
    stubCache({ 'https://x/part-000.bin': part0 }); // part-001 はブラウザに消された
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const done: number[] = [];
    await expect(streamWeights(fakeDevice, 'https://x', header, [], (d) => done.push(d), { allowNetwork: false }))
      .rejects.toBeInstanceOf(SarashinaNotCachedError);
    expect(done).toEqual([1]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('install (allowNetwork: true) still fetches a missing file', async () => {
    const buf = new Uint8Array([9, 9, 9, 9]).buffer;
    stubCache({});
    const fetchSpy = vi.fn(async () => new Response(buf));
    vi.stubGlobal('fetch', fetchSpy);
    const got = await fetchVerified('https://x/tokenizer.json', { bytes: 4, sha256: await sha256Hex(buf) }, { allowNetwork: true });
    expect(new Uint8Array(got)).toEqual(new Uint8Array(buf));
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
