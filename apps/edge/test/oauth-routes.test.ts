import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { handleClientMetadata, handleOAuthStart, handleOAuthStatus, handleOAuthCallback, validateReturnTo, type OAuthRoutesEnv } from '../src/oauth-routes';
import { putPendingAuth, readServerTokens, writeServerTokens } from '../src/oauth-store';
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
const env = (kv?: KVNamespace): OAuthRoutesEnv => ({ OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID: 'did:plc:testserver', WORKER_DID: 'did:web:edge.aozoraquest.app', ADMIN_DIDS: 'did:plc:admin1', OAUTH_TOKENS: kv });

const discoveryFetch = (extra: Record<string, () => Response> = {}) => (async (url: string) => {
  if (url.includes('plc.directory')) return json({ id: 'did:plc:testserver', service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] });
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

  it('status: 認証ゲート (401/403) + トークン本体を絶対に返さない', async () => {
    const url = 'https://x/api/oauth/status';
    // トークン無し → 401
    expect((await handleOAuthStatus(new Request(url), env(mockKv()), { now: NOW })).status).toBe(401);
    const req = new Request(url, { headers: { authorization: 'Bearer T' } });
    // 非管理者 → 403
    expect((await handleOAuthStatus(req, env(mockKv()), { now: NOW, verify: async () => ({ iss: 'did:plc:someone' }) })).status).toBe(403);
    // 未連携 (KV にトークン無し) → linked:false
    const unlinked = await handleOAuthStatus(req, env(mockKv()), { now: NOW, verify: okVerify });
    expect(await unlinked.json()).toEqual({ linked: false });
    // 連携済み → did/pdsUrl/失効/更新のみ、**トークン本体 (accessToken/refreshToken/authServer) は返さない**
    const kv = mockKv();
    await writeServerTokens(kv, { did: 'did:plc:testserver', accessToken: 'SECRET_AT', refreshToken: 'SECRET_RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: 'https://pds.example', authServer: AS, updatedAt: NOW });
    const linked = await handleOAuthStatus(req, env(kv), { now: NOW, verify: okVerify });
    const body = (await linked.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ linked: true, did: 'did:plc:testserver', pdsUrl: 'https://pds.example', expiresAt: NOW + 3600, updatedAt: NOW });
    const s = JSON.stringify(body);
    expect(s).not.toContain('SECRET_AT');
    expect(s).not.toContain('SECRET_RT');
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('refreshToken');
    expect(body).not.toHaveProperty('authServer');
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
    const f = discoveryFetch({ '/oauth/token': () => json({ access_token: 'AT', token_type: 'DPoP', refresh_token: 'RT', expires_in: 3600, sub: 'did:plc:testserver' }) });
    const res = await handleOAuthCallback(new Request('https://x/oauth/callback?code=CODE&state=ST'), env(kv), { now: NOW, fetchImpl: f });
    expect(res.status).toBe(200);
    const saved = await readServerTokens(kv);
    expect(saved).toMatchObject({ did: 'did:plc:testserver', accessToken: 'AT', refreshToken: 'RT' });
  });

  it('callback: returnTo 付き pending は web アプリへ 302 で戻す (serverOAuth=linked)', async () => {
    const kv = mockKv();
    await putPendingAuth(kv, 'ST', { verifier: 'VER', authServer: meta, pdsUrl: 'https://pds.example', createdAt: NOW, returnTo: 'https://dev.aozoraquest.app/settings' });
    const f = discoveryFetch({ '/oauth/token': () => json({ access_token: 'AT', token_type: 'DPoP', refresh_token: 'RT', expires_in: 3600, sub: 'did:plc:testserver' }) });
    const res = await handleOAuthCallback(new Request('https://x/oauth/callback?code=CODE&state=ST'), env(kv), { now: NOW, fetchImpl: f });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('https://dev.aozoraquest.app/settings');
    expect(loc).toContain('serverOAuth=linked');
    expect(await readServerTokens(kv)).toMatchObject({ did: 'did:plc:testserver' }); // 戻す前に保存済み
  });

  it('validateReturnTo: ALLOWED_ORIGINS の origin の http(s) URL のみ許可 (open-redirect 防止)', () => {
    const allowed = 'https://dev.aozoraquest.app,http://127.0.0.1:9999';
    // 許可 origin
    expect(validateReturnTo('https://dev.aozoraquest.app/settings', allowed)).toBe('https://dev.aozoraquest.app/settings');
    expect(validateReturnTo('http://127.0.0.1:9999/settings?x=1', allowed)).toBe('http://127.0.0.1:9999/settings?x=1');
    // 不許可 origin / スキーム / 不正値 → undefined
    expect(validateReturnTo('https://evil.example/steal', allowed)).toBeUndefined();
    expect(validateReturnTo('javascript:alert(1)', allowed)).toBeUndefined();
    expect(validateReturnTo('/relative/path', allowed)).toBeUndefined();
    // open-redirect バイパス系はすべて弾く
    expect(validateReturnTo('https://dev.aozoraquest.app@evil.example/x', allowed)).toBeUndefined(); // userinfo トリック (origin=evil)
    expect(validateReturnTo('https://dev.aozoraquest.app.evil.example/x', allowed)).toBeUndefined(); // サブドメイン suffix
    expect(validateReturnTo('https://dev.aozoraquest.app:8443/x', allowed)).toBeUndefined(); // ポート違い
    expect(validateReturnTo('https://user:pass@dev.aozoraquest.app/settings', allowed)).toBeUndefined(); // 許可 origin でも userinfo は拒否
    expect(validateReturnTo('data:text/html,x', allowed)).toBeUndefined();
    expect(validateReturnTo('', allowed)).toBeUndefined();
    expect(validateReturnTo(undefined, allowed)).toBeUndefined();
    expect(validateReturnTo(123, allowed)).toBeUndefined();
    expect(validateReturnTo('https://dev.aozoraquest.app/settings', undefined)).toBeUndefined(); // 許可リスト無し
  });
});
