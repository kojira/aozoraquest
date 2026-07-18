import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from '../session';

describe('withTimeout (warmup ハング対策)', () => {
  afterEach(() => vi.useRealTimers());

  it('restore ラベルのハングは restore-timeout で reject (無限「準備しています」を防ぐ)', async () => {
    vi.useFakeTimers();
    const hang = new Promise<string>(() => {}); // 解決しない = 壊れたセッションの client.init()
    const p = withTimeout(hang, 8_000, 'restore');
    const assertion = expect(p).rejects.toThrow('restore-timeout');
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });

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

describe('clearOAuthStorage (壊れた永続セッションの復旧)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  it('IDB @atproto-oauth-client を削除する (onsuccess で解決)', async () => {
    let opened: string | undefined;
    const del = vi.fn((name: string) => {
      opened = name;
      const req: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
      queueMicrotask(() => req.onsuccess?.());
      return req;
    });
    vi.stubGlobal('indexedDB', { deleteDatabase: del } as unknown as IDBFactory);
    const { clearOAuthStorage } = await import('../oauth');
    await clearOAuthStorage();
    expect(del).toHaveBeenCalledOnce();
    expect(opened).toBe('@atproto-oauth-client');
  });

  it('blocked (init が接続保持) でも待ち続けず解決する', async () => {
    const del = vi.fn(() => {
      const req: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
      queueMicrotask(() => req.onblocked?.()); // 接続保持で blocked
      return req;
    });
    vi.stubGlobal('indexedDB', { deleteDatabase: del } as unknown as IDBFactory);
    const { clearOAuthStorage } = await import('../oauth');
    await expect(clearOAuthStorage()).resolves.toBeUndefined();
  });

  it('IDB が一切イベントを出さなくても 2s 保険で解決する (永久待ちしない)', async () => {
    const del = vi.fn(() => ({} as unknown as IDBOpenDBRequest)); // ハンドラを一切呼ばない実装
    vi.stubGlobal('indexedDB', { deleteDatabase: del } as unknown as IDBFactory);
    const { clearOAuthStorage } = await import('../oauth');
    vi.useFakeTimers();
    const p = clearOAuthStorage();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(p).resolves.toBeUndefined();
  });
});
