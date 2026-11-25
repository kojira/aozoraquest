import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * 外部つなぎ先の差し替え (#1018)。核心は「**未設定なら本物の Bluesky のまま**」と
 * 「設定したらそちらを使う」。モジュールトップレベルで import.meta.env を読むので stubEnv + 動的 import。
 */
describe('atproto-endpoints: 外部つなぎ先', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

  test('未設定なら既定 (plc.directory / api.bsky.app / bsky.social、http 不許可)', async () => {
    vi.stubEnv('VITE_PLC_DIRECTORY_URL', '');
    vi.stubEnv('VITE_PUBLIC_APPVIEW_URL', '');
    vi.stubEnv('VITE_HANDLE_RESOLVER_URL', '');
    vi.stubEnv('VITE_ATPROTO_ALLOW_HTTP', '');
    const m = await import('./atproto-endpoints');
    expect(m.PLC_DIRECTORY_URL).toBe('https://plc.directory');
    expect(m.PUBLIC_APPVIEW_URL).toBe('https://api.bsky.app');
    expect(m.HANDLE_RESOLVER_URL).toBe('https://bsky.social');
    expect(m.ATPROTO_ALLOW_HTTP).toBe(false);
  });

  test('設定すればローカルを使う (末尾スラッシュは落とす)', async () => {
    vi.stubEnv('VITE_PLC_DIRECTORY_URL', 'http://localhost:2582/');
    vi.stubEnv('VITE_PUBLIC_APPVIEW_URL', 'http://localhost:2583');
    vi.stubEnv('VITE_HANDLE_RESOLVER_URL', 'http://localhost:2583');
    vi.stubEnv('VITE_ATPROTO_ALLOW_HTTP', '1');
    const m = await import('./atproto-endpoints');
    expect(m.PLC_DIRECTORY_URL).toBe('http://localhost:2582');
    expect(m.PUBLIC_APPVIEW_URL).toBe('http://localhost:2583');
    expect(m.HANDLE_RESOLVER_URL).toBe('http://localhost:2583');
    expect(m.ATPROTO_ALLOW_HTTP).toBe(true); // vitest は DEV=true
  });

  test('http 許可は本番ビルド (DEV=false) では効かない', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ATPROTO_ALLOW_HTTP', '1');
    const m = await import('./atproto-endpoints');
    expect(m.ATPROTO_ALLOW_HTTP).toBe(false);
  });

  test('resolveDidToPds は設定した PLC を引く / 未設定なら plc.directory', async () => {
    const doc = { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'http://localhost:2583' }] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(doc), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    vi.stubEnv('VITE_PLC_DIRECTORY_URL', 'http://localhost:2582');
    const local = await import('./runtime-config');
    expect(await local.resolveDidToPds('did:plc:abc')).toBe('http://localhost:2583');
    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:2582/did%3Aplc%3Aabc');

    vi.resetModules();
    vi.stubEnv('VITE_PLC_DIRECTORY_URL', '');
    const prod = await import('./runtime-config');
    await prod.resolveDidToPds('did:plc:abc');
    expect(fetchMock).toHaveBeenLastCalledWith('https://plc.directory/did%3Aplc%3Aabc');
  });
});
