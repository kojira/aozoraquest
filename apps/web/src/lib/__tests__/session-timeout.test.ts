import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from '../session';

describe('withTimeout (warmup ハング対策)', () => {
  afterEach(() => vi.useRealTimers());

  it('期限内に解決すれば値を返す', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'warmup')).resolves.toBe('ok');
  });

  it('期限内に reject すればその理由を伝える (タイムアウトで上書きしない)', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'warmup')).rejects.toThrow('boom');
  });

  it('解決しない promise は ms 後に <label>-timeout で reject (無限ハングにしない)', async () => {
    vi.useFakeTimers();
    const hang = new Promise<string>(() => {}); // 永遠に解決しない (= 壊れたセッションの getSession)
    const p = withTimeout(hang, 10_000, 'warmup');
    const assertion = expect(p).rejects.toThrow('warmup-timeout');
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('解決が勝てばタイマーは片付けられ、後からの発火で余計な reject を残さない', async () => {
    vi.useFakeTimers();
    const p = withTimeout(Promise.resolve('done'), 10_000, 'warmup');
    await expect(p).resolves.toBe('done');
    // タイマーが残っていないこと (finally の clearTimeout)。進めても何も起きない。
    await vi.advanceTimersByTimeAsync(20_000);
  });
});
