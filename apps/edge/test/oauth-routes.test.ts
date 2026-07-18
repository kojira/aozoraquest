import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { handleClientMetadata, handleOAuthStart, handleOAuthCallback, type OAuthRoutesEnv } from '../src/oauth-routes';
import { putPendingAuth, readServerTokens } from '../src/oauth-store';
import type { AuthServerMetadata } from '../src/oauth-metadata';

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
const meta: AuthServerMetadata = { issuer: AS, authorization_endpoint: `${AS}/oauth/authorize`, token_endpoint: `${AS}/oauth/token`, pushed_authorization_request_endpoint: `${AS}/oauth/par` };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const env = (kv?: KVNamespace): OAuthRoutesEnv => ({ OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID: 'did:plc:kojira', WORKER_DID: 'did:web:edge.aozoraquest.app', ADMIN_DIDS: 'did:plc:admin1', OAUTH_TOKENS: kv });

const discoveryFetch = (extra: Record<string, () => Response> = {}) => (async (url: string) => {
  if (url.includes('plc.directory')) return json({ id: 'did:plc:kojira', service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] });
  if (url.includes('oauth-protected-resource')) return json({ authorization_servers: [AS] });
  if (url.includes('oauth-authorization-server')) return json(meta);
  for (const [frag, fn] of Object.entries(extra)) if (url.includes(frag)) return fn();
  return json({ error: 'nf' }, 404);
}) as unknown as typeof fetch;

const okVerify = async () => ({ iss: 'did:plc:admin1' });
const NOW = 1000;

describe('oauth-routes', () => {
  it('client-metadata: 設定ありで confidential client を返す / 未設定は 503', () => {
    expect(handleClientMetadata(env()).status).toBe(200);
    expect(handleClientMetadata({ ...env(), OAUTH_CLIENT_PRIVATE_JWK: undefined }).status).toBe(503);
  });

  it('start: KV 未 binding は 503 / トークン無しは 401', async () => {
    expect((await handleOAuthStart(new Request('https://x/api/oauth/start', { method: 'POST' }), env(), { now: NOW })).status).toBe(503);
    const r = await handleOAuthStart(new Request('https://x/api/oauth/start', { method: 'POST' }), env(mockKv()), { now: NOW });
    expect(r.status).toBe(401);
  });

  it('start: 検証失敗は 401 / 非管理者は 403', async () => {
    const req = new Request('https://x/api/oauth/start', { method: 'POST', headers: { authorization: 'Bearer t' } });
    const bad = await handleOAuthStart(req, env(mockKv()), { now: NOW, verify: async () => { throw new Error('bad'); } });
    expect(bad.status).toBe(401);
    const nonAdmin = await handleOAuthStart(req, env(mockKv()), { now: NOW, verify: async () => ({ iss: 'did:plc:someone' }) });
    expect(nonAdmin.status).toBe(403);
  });

  it('start: 管理者は PAR して authorizeUrl を返し pending を保存する', async () => {
    const kv = mockKv();
    const req = new Request('https://x/api/oauth/start', { method: 'POST', headers: { authorization: 'Bearer t' } });
    const res = await handleOAuthStart(req, env(kv), { now: NOW, verify: okVerify, fetchImpl: discoveryFetch({ '/oauth/par': () => json({ request_uri: 'urn:req:1' }) }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizeUrl: string };
    expect(body.authorizeUrl).toContain(`${AS}/oauth/authorize`);
    expect(body.authorizeUrl).toContain('request_uri=urn%3Areq%3A1');
  });

  it('callback: error パラメータは失敗ページ / code|state 欠落は 400', async () => {
    expect((await handleOAuthCallback(new Request('https://x/oauth/callback?error=access_denied'), env(mockKv()), { now: NOW })).status).toBe(400);
    expect((await handleOAuthCallback(new Request('https://x/oauth/callback?code=c'), env(mockKv()), { now: NOW })).status).toBe(400);
  });

  it('callback: 未知 state は 400 (CSRF/期限切れ)', async () => {
    const res = await handleOAuthCallback(new Request('https://x/oauth/callback?code=c&state=unknown'), env(mockKv()), { now: NOW });
    expect(res.status).toBe(400);
  });

  it('callback: 正しい state で code を token に交換し KV に保存する', async () => {
    const kv = mockKv();
    await putPendingAuth(kv, 'ST', { verifier: 'VER', authServer: meta, pdsUrl: 'https://pds.example', createdAt: NOW });
    const f = discoveryFetch({ '/oauth/token': () => json({ access_token: 'AT', token_type: 'DPoP', refresh_token: 'RT', expires_in: 3600, sub: 'did:plc:kojira' }) });
    const res = await handleOAuthCallback(new Request('https://x/oauth/callback?code=CODE&state=ST'), env(kv), { now: NOW, fetchImpl: f });
    expect(res.status).toBe(200);
    const saved = await readServerTokens(kv);
    expect(saved).toMatchObject({ did: 'did:plc:kojira', accessToken: 'AT', refreshToken: 'RT' });
  });
});
