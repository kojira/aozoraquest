import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { runCronRefresh, REFRESH_AHEAD_SEC, type CronEnv } from '../src/oauth-cron';
import { writeServerTokens, readServerTokens, type ServerOAuthTokens } from '../src/oauth-store';

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
function mockKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
}
const AS = 'https://bsky.social';
const env = (kv?: KVNamespace): CronEnv => ({ OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID: 'did:plc:kojira', WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const NOW = 100000;
const tokens = (over: Partial<ServerOAuthTokens> = {}): ServerOAuthTokens => ({ did: 'did:plc:kojira', accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, authServer: AS, updatedAt: NOW, ...over });

const refreshFetch = (tokenResp: () => Response) => (async (url: string) => {
  if (url.includes('plc.directory')) return json({ id: 'did:plc:kojira', service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] });
  if (url.includes('oauth-protected-resource')) return json({ authorization_servers: [AS] });
  if (url.includes('oauth-authorization-server')) return json({ issuer: AS, authorization_endpoint: `${AS}/a`, token_endpoint: `${AS}/oauth/token`, pushed_authorization_request_endpoint: `${AS}/par` });
  if (url.includes('/oauth/token')) return tokenResp();
  return json({ error: 'nf' }, 404);
}) as unknown as typeof fetch;

describe('oauth-cron', () => {
  it('KV 無し / 未 bootstrap は skip', async () => {
    expect((await runCronRefresh(env(), NOW)).status).toBe('no-kv');
    expect((await runCronRefresh(env(mockKv()), NOW)).status).toBe('not-bootstrapped');
  });

  it('期限に余裕があれば not-due (無駄な refresh をしない)', async () => {
    const kv = mockKv();
    await writeServerTokens(kv, tokens({ expiresAt: NOW + REFRESH_AHEAD_SEC + 100 }));
    expect((await runCronRefresh(env(kv), NOW)).status).toBe('not-due');
  });

  it('期限が近ければ refresh して KV を更新 (dpopNonce は保持)', async () => {
    const kv = mockKv();
    await writeServerTokens(kv, tokens({ expiresAt: NOW + 60, dpopNonce: 'PDS-NONCE' }));
    const f = refreshFetch(() => json({ access_token: 'AT2', token_type: 'DPoP', refresh_token: 'RT2', expires_in: 3600, sub: 'did:plc:kojira' }));
    const r = await runCronRefresh(env(kv), NOW, f);
    expect(r.status).toBe('refreshed');
    const saved = await readServerTokens(kv);
    expect(saved).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT2', dpopNonce: 'PDS-NONCE' });
    expect(saved!.expiresAt).toBe(NOW + 3600);
  });

  it('refresh 失敗 (invalid_grant) は error を返しトークンは残す (診断用)', async () => {
    const kv = mockKv();
    await writeServerTokens(kv, tokens({ expiresAt: NOW + 60 }));
    const f = refreshFetch(() => json({ error: 'invalid_grant' }, 400));
    const r = await runCronRefresh(env(kv), NOW, f);
    expect(r.status).toBe('error');
    expect((await readServerTokens(kv))?.refreshToken).toBe('RT'); // 消さない
  });

  it('設定不備 (鍵欠落) は not-configured', async () => {
    const kv = mockKv();
    await writeServerTokens(kv, tokens({ expiresAt: NOW + 60 }));
    const r = await runCronRefresh({ ...env(kv), OAUTH_CLIENT_PRIVATE_JWK: undefined }, NOW);
    expect(r.status).toBe('not-configured');
  });
});
