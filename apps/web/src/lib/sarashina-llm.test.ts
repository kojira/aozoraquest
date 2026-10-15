import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 翻訳時の読み込みでキャッシュが欠けていたら (Worker が code: 'not-cached' を返したら)、ダウンロードせず未導入に戻る。
 * Worker 側でネットワークを使わないことは slm-wgsl/weights.test.ts が確かめる。ここでは init が allowNetwork: false で
 * 送られ、結果が「未導入」として翻訳 backend の選択から外れることを確かめる。
 */
const cache = vi.hoisted(() => ({ complete: true }));
vi.mock('./slm-wgsl/weights', () => ({ isSarashinaCached: async () => cache.complete }));
vi.mock('./gemini-nano-availability', () => ({ detectGeminiNano: async () => 'unavailable' }));
vi.mock('./gemini-nano-llm', () => ({
  GEMINI_NANO: { id: 'gemini-nano', label: 'Nano', availability: async () => false, generate: async () => '' },
}));

const inits: unknown[] = [];
class FakeWorker {
  private listeners: Array<(ev: { data: unknown }) => void> = [];
  addEventListener(type: string, fn: (ev: { data: unknown }) => void) { if (type === 'message') this.listeners.push(fn); }
  removeEventListener(_: string, fn: (ev: { data: unknown }) => void) { this.listeners = this.listeners.filter((l) => l !== fn); }
  terminate() {}
  postMessage(m: { type: string; allowNetwork?: boolean }) {
    if (m.type !== 'init') return;
    inits.push(m);
    // 実 Worker と同じ応答: キャッシュが欠けていて取得も許されていない
    queueMicrotask(() => { for (const l of [...this.listeners]) l({ data: { type: 'error', code: 'not-cached', error: 'sarashina not cached (part-003.bin)' } }); });
  }
}

describe('sarashina translate-time load', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('rejects as not installed without network, and drops sarashina from translation', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('navigator', { gpu: {} });
    const { loadSarashina, isSarashinaInstalled, SarashinaNotInstalledError } = await import('./sarashina-llm');
    const { pickLocalLLM, resetLocalLLMChoice } = await import('./local-llm');

    expect((await pickLocalLLM(false, 'translation'))?.id).toBe('sarashina-0.5b'); // 導入済みと memoize された状態
    cache.complete = false; // その後ブラウザがキャッシュを消した

    await expect(loadSarashina()).rejects.toBeInstanceOf(SarashinaNotInstalledError);
    expect(inits).toEqual([{ type: 'init', allowNetwork: false }]);
    expect(await isSarashinaInstalled()).toBe(false);
    resetLocalLLMChoice(); // translate.ts が SarashinaNotInstalledError で呼ぶ
    expect(await pickLocalLLM(false, 'translation')).toBeNull();
  });
});
