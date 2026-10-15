import { describe, it, expect } from 'vitest';
import { readServerTokens, writeServerTokens, readPdsNonce, writePdsNonce, clearServerTokens, putPendingAuth, takePendingAuth, SERVER_OAUTH_KEY, type ServerOAuthTokens } from '../src/oauth-store';
import type { AuthServerMetadata } from '../src/oauth-metadata';

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
  expiresAt: 2000, pdsUrl: 'https://pds.example', authServer: 'https://bsky.social', updatedAt: 1000, ...over,
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

  it('PDS nonce は別キーで読み書きし、トークンレコードを巻き込まない (★★)', async () => {
    const { kv } = mockKv();
    await writeServerTokens(kv, tokens());
    expect(await readPdsNonce(kv)).toBeNull();
    await writePdsNonce(kv, 'NONCE-1');
    expect(await readPdsNonce(kv)).toBe('NONCE-1');
    // トークン本体は無傷 (別キーなので cron の書き込みとぶつからない)
    expect((await readServerTokens(kv))?.accessToken).toBe('AT');
  });

  it('clearServerTokens で消える (再 OAuth 前クリーンアップ)', async () => {
    const { kv } = mockKv();
    await writeServerTokens(kv, tokens());
    await clearServerTokens(kv);
    expect(await readServerTokens(kv)).toBeNull();
  });

  const authServer: AuthServerMetadata = { issuer: 'https://bsky.social', authorization_endpoint: 'a', token_endpoint: 't', pushed_authorization_request_endpoint: 'p' };

  it('pending は state キーで保存し、take で取り出して削除 (使い捨て=リプレイ防止)', async () => {
    const { kv } = mockKv();
    await putPendingAuth(kv, 'STATE1', { verifier: 'VER', authServer, pdsUrl: 'https://pds.example', createdAt: 1000 });
    const p = await takePendingAuth(kv, 'STATE1');
    expect(p?.verifier).toBe('VER');
    expect(p?.authServer.issuer).toBe('https://bsky.social');
    // 2 回目は消えている (リプレイ不可)
    expect(await takePendingAuth(kv, 'STATE1')).toBeNull();
  });

  it('未知の state は null', async () => {
    const { kv } = mockKv();
    expect(await takePendingAuth(kv, 'nope')).toBeNull();
  });
});
