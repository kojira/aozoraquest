import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropStaleSlmCaches, planSlmInstall, SLM_DOWNLOAD_BYTES } from './slm-install';
import { SARASHINA_CACHE_NAME, SLM_BASE_URL, SLM_CACHE_NAME, type SlmHeader } from './slm-wgsl/weights';

const MB = 1_000_000;
const need = Math.ceil(SLM_DOWNLOAD_BYTES * 1.1);

describe('planSlmInstall (空き容量を見る時点で順番を決める)', () => {
  it('installs first and keeps sarashina until LFM is verified when there is room', () => {
    expect(planSlmInstall({ quota: need + 10 * MB, usage: 0 }, true)).toBe('install-then-drop-sarashina');
    expect(planSlmInstall({ quota: need, usage: 0 }, false)).toBe('install-then-drop-sarashina');
  });

  it('drops sarashina first only when that frees enough room', () => {
    expect(planSlmInstall({ quota: need, usage: 300 * MB }, true)).toBe('drop-sarashina-first');
    expect(planSlmInstall({ quota: need, usage: 300 * MB }, false)).toBe('not-enough');
    expect(planSlmInstall({ quota: need, usage: 600 * MB }, true)).toBe('not-enough');
  });

  it('requires 660MB plus a 10% margin', () => {
    expect(planSlmInstall({ quota: SLM_DOWNLOAD_BYTES + 1, usage: 0 }, false)).toBe('not-enough');
  });

  it('goes ahead when the browser cannot tell the free space', () => {
    expect(planSlmInstall(null, false)).toBe('install-then-drop-sarashina');
  });
});

/** Cache Storage の偽物。名前ごとに URL の集合を持つ。 */
function stubCaches(init: Record<string, string[]>) {
  const store = new Map(Object.entries(init).map(([k, v]) => [k, new Set(v)]));
  vi.stubGlobal('caches', {
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    has: async (name: string) => store.has(name),
    open: async (name: string) => {
      const urls = store.get(name) ?? new Set<string>();
      store.set(name, urls);
      return {
        keys: async () => [...urls].map((u) => new Request(u)),
        delete: async (r: Request | string) => urls.delete(typeof r === 'string' ? r : r.url),
      };
    },
  });
  return store;
}

const header = {
  parts: [{ file: 'part-000.bin' }, { file: 'part-001.bin' }],
  tokenizer: { file: 'tokenizer.json' },
} as unknown as SlmHeader;
const cur = (f: string) => `${SLM_BASE_URL}/${f}`;

describe('dropStaleSlmCaches (自分の名前空間だけを消す)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('keeps the classifier / embedding / tokenizer caches and unknown caches', async () => {
    const store = stubCaches({
      'cognitive-wgsl-v1': ['https://hf/model.aqw'],
      'transformers-cache': ['https://hf/tokenizer.json'],
      'someone-else': ['https://x/y'],
      [SARASHINA_CACHE_NAME]: ['https://hf/sara/part-000.bin'],
      'slm-wgsl-v0': ['https://hf/old/part-000.bin'],
      [SLM_CACHE_NAME]: [cur('header.json'), cur('part-000.bin'), cur('part-001.bin'), cur('tokenizer.json')],
    });
    await dropStaleSlmCaches(header);
    expect([...store.keys()].sort()).toEqual(['cognitive-wgsl-v1', 'slm-wgsl-v1', 'someone-else', 'transformers-cache']);
    expect([...store.get(SLM_CACHE_NAME)!].length).toBe(4);
  });

  it('removes URLs of an older commit or files the current header does not list from the LFM cache', async () => {
    const store = stubCaches({
      [SLM_CACHE_NAME]: [cur('header.json'), cur('part-000.bin'), cur('part-001.bin'), cur('tokenizer.json'), cur('part-002.bin'), 'https://hf/resolve/oldsha/wgsl/lfm/part-000.bin'],
    });
    await dropStaleSlmCaches(header);
    expect([...store.get(SLM_CACHE_NAME)!].sort()).toEqual([cur('header.json'), cur('part-000.bin'), cur('part-001.bin'), cur('tokenizer.json')].sort());
  });
});
