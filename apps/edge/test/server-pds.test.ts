import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { serverPutRecord, serverDeleteRecord, ServerWriteError, type ServerPdsEnv } from '../src/server-pds';
import { writeServerTokens, readPdsNonce, type ServerOAuthTokens } from '../src/oauth-store';

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
function mockKv() {
  const m = new Map<string, string>();
  return { kv: { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace, m };
}
const PDS = 'https://pds.example';
const NOW = 100000;
const tokens = (over: Partial<ServerOAuthTokens> = {}): ServerOAuthTokens => ({ did: 'did:plc:kojira', accessToken: 'ATOKEN', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: PDS, authServer: 'https://bsky.social', updatedAt: NOW, ...over });
const env = (kv?: KVNamespace): ServerPdsEnv => ({ OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID: 'did:plc:kojira', WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv });
const json = (b: unknown, s = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', ...h } });

describe('server-pds (OAuth DPoP 書き込み)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('serverPutRecord は repo=サーバーDID + DPoP + Authorization を付けて putRecord する', async () => {
    const { kv } = mockKv();
    await writeServerTokens(kv, tokens());
    let seen: { url: string; headers: Headers; body: unknown } | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => { seen = { url, headers: new Headers(init.headers), body: JSON.parse(init.body as string) }; return json({ uri: 'at://x', cid: 'CID1' }); }) as unknown as typeof fetch;
    const r = await serverPutRecord(env(kv), NOW, 'app.aozoraquest.gameState', 'u123', { power: 5 }, null);
    expect(r).toMatchObject({ uri: 'at://x', cid: 'CID1' });
    expect(seen!.url).toBe(`${PDS}/xrpc/com.atproto.repo.putRecord`);
    expect(seen!.headers.get('DPoP')).toBeTruthy();
    expect(seen!.headers.get('Authorization')).toBe('DPoP ATOKEN');
    expect(seen!.body).toMatchObject({ repo: 'did:plc:kojira', collection: 'app.aozoraquest.gameState', rkey: 'u123', record: { power: 5 }, swapRecord: null });
  });

  it('未 bootstrap / KV 無し / 失効 / 設定不備は fail-closed (ServerWriteError)', async () => {
    await expect(serverPutRecord(env(), NOW, 'c', 'r', {})).rejects.toMatchObject({ reason: 'no-kv' });
    const { kv } = mockKv();
    await expect(serverPutRecord(env(kv), NOW, 'c', 'r', {})).rejects.toMatchObject({ reason: 'not-bootstrapped' });
    await writeServerTokens(kv, tokens({ expiresAt: NOW - 1 }));
    await expect(serverPutRecord(env(kv), NOW, 'c', 'r', {})).rejects.toMatchObject({ reason: 'token-expired' });
    const { kv: kv2 } = mockKv();
    await writeServerTokens(kv2, tokens());
    await expect(serverPutRecord({ ...env(kv2), OAUTH_DPOP_PRIVATE_JWK: undefined }, NOW, 'c', 'r', {})).rejects.toMatchObject({ reason: 'not-configured' });
  });

  it('CAS 競合 (InvalidSwap) は PdsError.xrpcError で判別できる', async () => {
    const { kv } = mockKv();
    await writeServerTokens(kv, tokens());
    globalThis.fetch = (async () => json({ error: 'InvalidSwap', message: 'CID mismatch' }, 400)) as unknown as typeof fetch;
    try {
      await expect(serverPutRecord(env(kv), NOW, 'c', 'r', {}, 'STALE')).rejects.toMatchObject({ xrpcError: 'InvalidSwap' });
    } finally { /* restored below */ }
  });

  it('use_dpop_nonce チャレンジで nonce を KV に保存し再送して成功する', async () => {
    const { kv } = mockKv();
    await writeServerTokens(kv, tokens());
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return calls === 1 ? json({ error: 'use_dpop_nonce' }, 401, { 'DPoP-Nonce': 'PDSN1' }) : json({ uri: 'at://x', cid: 'CID2' }); }) as unknown as typeof fetch;
    const r = await serverPutRecord(env(kv), NOW, 'c', 'r', {});
    expect(calls).toBe(2);
    expect(r.cid).toBe('CID2');
    expect(await readPdsNonce(kv)).toBe('PDSN1'); // 次回のため保存
  });

  it('serverDeleteRecord は swapRecord CAS 付きで deleteRecord する', async () => {
    const { kv } = mockKv();
    await writeServerTokens(kv, tokens());
    let body: unknown;
    globalThis.fetch = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return json({}); }) as unknown as typeof fetch;
    await serverDeleteRecord(env(kv), NOW, 'c', 'r', 'CID9');
    expect(body).toMatchObject({ repo: 'did:plc:kojira', collection: 'c', rkey: 'r', swapRecord: 'CID9' });
  });
});
