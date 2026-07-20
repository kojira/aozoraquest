import { describe, expect, test, afterEach, vi } from 'vitest';

/**
 * エッジ URL の環境別解決の回帰防止。核心は「**dev ビルドは本番エッジを叩かない**」
 * (#396: .env.production を本番/dev 両ビルドが読むため VITE_EDGE_URL が本番エッジを
 * 指しても、VITE_NSID_ENV=dev なら dev エッジを強制する)。
 * モジュールトップレベルで import.meta.env を評価するので stubEnv + 動的 import。
 */
describe('world-server: エッジ URL の環境別解決', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  test('VITE_NSID_ENV=dev は VITE_EDGE_URL が本番エッジでも dev エッジを強制する', async () => {
    vi.stubEnv('VITE_NSID_ENV', 'dev');
    vi.stubEnv('VITE_EDGE_URL', 'https://aozoraquest-edge.kojiran.workers.dev'); // 本番エッジ
    vi.stubEnv('VITE_EDGE_DID', 'did:web:aozoraquest-edge.kojiran.workers.dev');
    const { __edgeForTest } = await import('./world-server');
    expect(__edgeForTest.url).toBe('https://aozoraquest-edge-dev.kojiran.workers.dev');
    expect(__edgeForTest.did).toBe('did:web:aozoraquest-edge-dev.kojiran.workers.dev');
    expect(__edgeForTest.url).not.toContain('edge.kojiran'); // 本番エッジに解決しない (edge-dev のみ)
  });

  test('本番 (VITE_NSID_ENV 未設定) は VITE_EDGE_URL (本番エッジ) を使う', async () => {
    vi.stubEnv('VITE_NSID_ENV', '');
    vi.stubEnv('VITE_EDGE_URL', 'https://aozoraquest-edge.kojiran.workers.dev');
    vi.stubEnv('VITE_EDGE_DID', 'did:web:aozoraquest-edge.kojiran.workers.dev');
    const { __edgeForTest } = await import('./world-server');
    expect(__edgeForTest.url).toBe('https://aozoraquest-edge.kojiran.workers.dev');
  });

  test('ローカル (VITE_NSID_ENV=local) は VITE_EDGE_URL (=.env.development の dev エッジ) を使う', async () => {
    vi.stubEnv('VITE_NSID_ENV', 'local');
    vi.stubEnv('VITE_EDGE_URL', 'https://aozoraquest-edge-dev.kojiran.workers.dev');
    vi.stubEnv('VITE_EDGE_DID', 'did:web:aozoraquest-edge-dev.kojiran.workers.dev');
    const { __edgeForTest } = await import('./world-server');
    expect(__edgeForTest.url).toBe('https://aozoraquest-edge-dev.kojiran.workers.dev');
  });
});
