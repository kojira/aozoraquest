import { describe, it, expect } from 'vitest';
import { readServerTokens, writeServerTokens, updateServerNonce, clearServerTokens, SERVER_OAUTH_KEY, type ServerOAuthTokens } from '../src/oauth-store';

/** 最小の in-memory KVNamespace モック (get/put/delete のみ)。 */
function mockKv() {
  const m = new Map<string, string>();
  const kv = {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => { m.set(k, v); },
    delete: async (k: string) => { m.delete(k); },
  } as unknown as KVNamespace;
  return { kv, m };
}

const tokens = (over: Partial<ServerOAuthTokens> = {}): ServerOAuthTokens => ({
  did: 'did:plc:server', accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP',
  expiresAt: 2000, authServer: 'https://bsky.social', updatedAt: 1000, ...over,
});

describe('oauth-store', () => {
  it('未 bootstrap は null / 保存後は読める', async () => {
    const { kv } = mockKv();
    expect(await readServerTokens(kv)).toBeNull();
    await writeServerTokens(kv, tokens());
    const t = await readServerTokens(kv);
    expect(t).toMatchObject({ did: 'did:plc:server', accessToken: 'AT', tokenType: 'DPoP' });
  });

  it('壊れた JSON は null (fail-closed 側)', async () => {
    const { kv, m } = mockKv();
    m.set(SERVER_OAUTH_KEY, '{not json');
    expect(await readServerTokens(kv)).toBeNull();
  });

  it('updateServerNonce は nonce だけ更新し他フィールドは保つ', async () => {
    const { kv } = mockKv();
    await writeServerTokens(kv, tokens({ dpopNonce: 'OLD' }));
    await updateServerNonce(kv, 'NEW', 1500);
    const t = await readServerTokens(kv);
    expect(t?.dpopNonce).toBe('NEW');
    expect(t?.accessToken).toBe('AT'); // 本体は不変
    expect(t?.updatedAt).toBe(1500);
  });

  it('updateServerNonce は同一 nonce や未 bootstrap では書かない', async () => {
    const { kv, m } = mockKv();
    // 未 bootstrap: 何もしない
    await updateServerNonce(kv, 'X', 1);
    expect(m.has(SERVER_OAUTH_KEY)).toBe(false);
    // 同一 nonce: 無駄書きしない (updatedAt が動かないことで確認)
    await writeServerTokens(kv, tokens({ dpopNonce: 'SAME', updatedAt: 1000 }));
    await updateServerNonce(kv, 'SAME', 9999);
    expect((await readServerTokens(kv))?.updatedAt).toBe(1000);
  });

  it('clearServerTokens で消える (再 OAuth 前クリーンアップ)', async () => {
    const { kv } = mockKv();
    await writeServerTokens(kv, tokens());
    await clearServerTokens(kv);
    expect(await readServerTokens(kv)).toBeNull();
  });
});
