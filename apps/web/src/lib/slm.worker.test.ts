import { describe, expect, it, vi } from 'vitest';

/** 2 本目の generate は 1 本目が終わるまで model.generate に入らない (P1-2: 共有 pos / KV / readback を壊さない)。 */
let active = 0;
let maxActive = 0;
const releases: Array<() => void> = [];

vi.mock('./slm-wgsl/weights', () => ({
  SARASHINA_BASE_URL: 'x',
  fetchHeader: async () => ({ tokenizer: { file: 't' } }),
  fetchVerified: async () => new TextEncoder().encode('{}').buffer,
}));
vi.mock('./slm-wgsl/sptok', () => ({
  SpTokenizer: class { encode() { return [1]; } decode() { return 'ok'; } },
}));
vi.mock('./slm-wgsl/model', () => ({
  WebGpuUnsupportedError: class extends Error {},
  SlmModel: {
    create: async () => ({
      lost: new Promise(() => {}),
      async generate() {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((r) => releases.push(r));
        active--;
        return [2];
      },
    }),
  },
}));

describe('slm.worker generate', () => {
  it('runs generations one at a time', async () => {
    const posted: Array<{ type: string; id?: string }> = [];
    let onMessage: ((ev: { data: unknown }) => void) | null = null;
    vi.stubGlobal('self', {
      addEventListener: (_: string, fn: (ev: { data: unknown }) => void) => { onMessage = fn; },
      postMessage: (m: { type: string }) => posted.push(m),
    });
    await import('./slm.worker');
    const send = (id: string) => onMessage!({ data: { type: 'generate', id, prompt: 'p', maxNewTokens: 4, temperature: 0, stopAtNewline: false } });
    send('a');
    send('b');
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(releases).toHaveLength(1);
    releases[0]!();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();
    await vi.waitFor(() => expect(posted.filter((m) => m.type === 'done').map((m) => m.id)).toEqual(['a', 'b']));
    expect(maxActive).toBe(1);
    vi.unstubAllGlobals();
  });
});
