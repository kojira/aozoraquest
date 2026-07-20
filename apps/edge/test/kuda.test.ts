import { describe, it, expect } from 'vitest';
import { csprngByte, drawKudaByte, entropyByte, entropyU32 } from '../src/kuda';

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
    const b = await entropyByte({ useKuda: true, apiKey: 'kuda_test', fetchImpl: f });
    expect(b.source).toBe('csprng'); // 障害でも戦闘は止めない
  });

  it('entropyByte(useKuda:true) は成功時 kuda を返す', async () => {
    const b = await entropyByte({ useKuda: true, apiKey: 'kuda_test', fetchImpl: (async () => okDrop(200)) as unknown as typeof fetch });
    expect(b).toMatchObject({ value: 200, source: 'kuda' });
  });

  it('entropyByte(useKuda:true) は apiKey 未設定なら kuda を使わず CSPRNG (fetch しない)', async () => {
    let called = false;
    const f = (async () => { called = true; return okDrop(1); }) as unknown as typeof fetch;
    const b = await entropyByte({ useKuda: true, fetchImpl: f }); // apiKey なし
    expect(b.source).toBe('csprng');
    expect(called).toBe(false); // キー無しで kuda を叩かない (無駄な 401 を避ける)
  });

  it('drawKudaByte は apiKey を Authorization: Bearer で送る', async () => {
    let authHeader: string | null = null;
    const f = (async (_url: string, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get('Authorization');
      return okDrop(5);
    }) as unknown as typeof fetch;
    await drawKudaByte({ apiKey: 'kuda_abc', fetchImpl: f });
    expect(authHeader).toBe('Bearer kuda_abc');
  });

  it('drawKudaByte は 2xx でも非 JSON 本文なら throw (プロキシ HTML 等)', async () => {
    const f = (async () => new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    await expect(drawKudaByte({ fetchImpl: f })).rejects.toThrow();
  });

  it('entropyByte の onFallback は kuda 障害時に呼ばれ、正常時は呼ばれない', async () => {
    let fell = 0;
    await entropyByte({ useKuda: true, apiKey: 'kuda_test', onFallback: () => { fell++; }, fetchImpl: (async () => { throw new Error('x'); }) as unknown as typeof fetch });
    expect(fell).toBe(1);
    await entropyByte({ useKuda: true, apiKey: 'kuda_test', onFallback: () => { fell++; }, fetchImpl: (async () => okDrop(9)) as unknown as typeof fetch });
    expect(fell).toBe(1); // 正常時は増えない
  });

  it('entropyU32 は 32bit の符号なし整数 (8bit より広い) を返す', () => {
    return (async () => {
      const seen = new Set<number>();
      let above16 = 0;
      for (let i = 0; i < 64; i++) {
        const r = await entropyU32();
        expect(r.source).toBe('csprng');
        expect(Number.isInteger(r.value)).toBe(true);
        expect(r.value).toBeGreaterThanOrEqual(0);
        expect(r.value).toBeLessThanOrEqual(0xffffffff);
        seen.add(r.value);
        if (r.value > 0xffff) above16++;
      }
      expect(seen.size).toBeGreaterThan(50); // 256 通りに縮退していない
      expect(above16).toBeGreaterThan(0); // 上位ビットが立つ = 8bit ではない
    })();
  });

  it('entropyU32(useKuda:true) は kuda 成功で物理バイトを混ぜ source を kuda+csprng に', async () => {
    const r = await entropyU32({ useKuda: true, apiKey: 'kuda_test', fetchImpl: (async () => okDrop(200)) as unknown as typeof fetch });
    expect(r.source).toBe('kuda+csprng');
    expect(r.meta).toBeTruthy();
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.value).toBeLessThanOrEqual(0xffffffff);
  });

  it('entropyU32(useKuda:true) は kuda 障害でも 32bit CSPRNG で成立 (fail-safe)', async () => {
    const r = await entropyU32({ useKuda: true, apiKey: 'kuda_test', fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch });
    expect(r.source).toBe('csprng');
    expect(r.value).toBeLessThanOrEqual(0xffffffff);
  });
});
