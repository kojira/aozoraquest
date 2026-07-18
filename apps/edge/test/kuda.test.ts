import { describe, it, expect } from 'vitest';
import { csprngByte, drawKudaByte, entropyByte } from '../src/kuda';

const okDrop = (value: number) =>
  new Response(JSON.stringify({ value, drop_seq: 1, pool_seq: 1, batch: 'b', drawn_at: 'x', pool_remaining: 100 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('kuda', () => {
  it('csprngByte は 0–255 の整数を返す', () => {
    for (let i = 0; i < 50; i++) {
      const b = csprngByte();
      expect(b.source).toBe('csprng');
      expect(Number.isInteger(b.value)).toBe(true);
      expect(b.value).toBeGreaterThanOrEqual(0);
      expect(b.value).toBeLessThanOrEqual(255);
    }
  });

  it('drawKudaByte は kuda 応答を EntropyByte にする', async () => {
    const b = await drawKudaByte({ fetchImpl: (async () => okDrop(172)) as unknown as typeof fetch });
    expect(b).toMatchObject({ value: 172, source: 'kuda' });
    expect(b.meta?.pool_remaining).toBe(100);
  });

  it('drawKudaByte は不正値 (範囲外) を throw', async () => {
    await expect(drawKudaByte({ fetchImpl: (async () => okDrop(999)) as unknown as typeof fetch })).rejects.toThrow();
  });

  it('drawKudaByte は非2xx を throw', async () => {
    const f = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(drawKudaByte({ fetchImpl: f })).rejects.toThrow();
  });

  it('entropyByte(useKuda:false) は CSPRNG のみ (fetch しない)', async () => {
    let called = false;
    const f = (async () => { called = true; return okDrop(1); }) as unknown as typeof fetch;
    const b = await entropyByte({ useKuda: false, fetchImpl: f });
    expect(b.source).toBe('csprng');
    expect(called).toBe(false);
  });

  it('entropyByte(useKuda:true) は kuda 障害時 CSPRNG にフォールバック', async () => {
    const f = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const b = await entropyByte({ useKuda: true, fetchImpl: f });
    expect(b.source).toBe('csprng'); // 障害でも戦闘は止めない
  });

  it('entropyByte(useKuda:true) は成功時 kuda を返す', async () => {
    const b = await entropyByte({ useKuda: true, fetchImpl: (async () => okDrop(200)) as unknown as typeof fetch });
    expect(b).toMatchObject({ value: 200, source: 'kuda' });
  });
});
