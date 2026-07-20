import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { base64urlnopad } from '@scure/base';
import { generatePkce, generateState, buildAuthorizeUrl, exchangeCode, refreshTokens } from '../src/oauth-client';
import type { EcJwk } from '../src/oauth-jwt';
import type { AuthServerMetadata } from '../src/oauth-metadata';

function makeJwk(fill: number): EcJwk {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return { kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d) };
}
const AS: AuthServerMetadata = {
  issuer: 'https://bsky.social',
  authorization_endpoint: 'https://bsky.social/oauth/authorize',
  token_endpoint: 'https://bsky.social/oauth/token',
  pushed_authorization_request_endpoint: 'https://bsky.social/oauth/par',
};
const NOW = 1000;
const cfg = () => ({ clientId: 'https://edge.example/client-metadata.json', redirectUri: 'https://edge.example/oauth/callback', scope: 'atproto transition:generic', clientJwk: makeJwk(3), dpopJwk: makeJwk(5), now: NOW });
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('oauth-client', () => {
  it('generatePkce は 43 文字 verifier と S256 challenge (決定的)', () => {
    const rand = new Uint8Array(32).fill(1);
    const p = generatePkce(rand);
    expect(p.verifier).toHaveLength(43);
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.challenge).toBe(base64urlnopad.encode(sha256(new TextEncoder().encode(p.verifier))));
    expect(generatePkce(rand).verifier).toBe(p.verifier); // 決定的
  });

  it('generateState は base64url', () => {
    expect(generateState(new Uint8Array(16).fill(2))).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('buildAuthorizeUrl は PAR して authorize URL を返し、正しい form を送る', async () => {
    let body = '';
    const f = (async (_u: string, init: RequestInit) => { body = init.body as string; return json({ request_uri: 'urn:req:abc' }); }) as unknown as typeof fetch;
    const r = await buildAuthorizeUrl({ ...cfg(), fetchImpl: f }, AS, { loginHint: 'server.example', state: 'ST', pkce: { verifier: 'VER', challenge: 'CHAL' } });
    expect(r.url).toBe(`https://bsky.social/oauth/authorize?client_id=${encodeURIComponent(cfg().clientId)}&request_uri=urn%3Areq%3Aabc`);
    expect(r.state).toBe('ST');
    expect(r.verifier).toBe('VER');
    const form = new URLSearchParams(body);
    expect(form.get('response_type')).toBe('code');
    expect(form.get('code_challenge')).toBe('CHAL');
    expect(form.get('code_challenge_method')).toBe('S256');
    expect(form.get('login_hint')).toBe('server.example');
    expect(form.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    expect(form.get('client_assertion')).toBeTruthy();
  });

  it('exchangeCode は token を正規化 (sub→did, expiresAt=now+expires_in)', async () => {
    let body = '';
    const f = (async (_u: string, init: RequestInit) => { body = init.body as string; return json({ access_token: 'AT', token_type: 'DPoP', refresh_token: 'RT', expires_in: 3600, sub: 'did:plc:testserver', scope: 'atproto' }); }) as unknown as typeof fetch;
    const t = await exchangeCode({ ...cfg(), fetchImpl: f }, AS, 'CODE', 'VER', 'https://pds.example', 'did:plc:testserver');
    expect(t).toMatchObject({ did: 'did:plc:testserver', accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, authServer: AS.issuer, pdsUrl: 'https://pds.example' });
    const form = new URLSearchParams(body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('CODE');
    expect(form.get('code_verifier')).toBe('VER');
  });

  it('refreshTokens は grant_type=refresh_token で更新する', async () => {
    let body = '';
    const f = (async (_u: string, init: RequestInit) => { body = init.body as string; return json({ access_token: 'AT2', token_type: 'DPoP', refresh_token: 'RT2', expires_in: 100, sub: 'did:plc:testserver' }); }) as unknown as typeof fetch;
    const t = await refreshTokens({ ...cfg(), fetchImpl: f }, AS, 'OLD_RT', 'https://pds.example', 'did:plc:testserver');
    expect(t.accessToken).toBe('AT2');
    expect(t.refreshToken).toBe('RT2');
    expect(new URLSearchParams(body).get('refresh_token')).toBe('OLD_RT');
  });

  it('refresh_token が無い応答はエラー', async () => {
    const f = (async () => json({ access_token: 'AT', token_type: 'DPoP', sub: 'did:plc:x' })) as unknown as typeof fetch;
    await expect(exchangeCode({ ...cfg(), fetchImpl: f }, AS, 'C', 'V', 'https://pds.example', 'did:plc:x')).rejects.toThrow(/refresh_token/);
  });

  it('sub が期待アカウントと違えば拒否 (アカウント取り違え/セッション固定対策)', async () => {
    const f = (async () => json({ access_token: 'AT', token_type: 'DPoP', refresh_token: 'RT', expires_in: 60, sub: 'did:plc:attacker' })) as unknown as typeof fetch;
    await expect(exchangeCode({ ...cfg(), fetchImpl: f }, AS, 'C', 'V', 'https://pds.example', 'did:plc:testserver')).rejects.toThrow(/予期しないアカウント/);
    // 一致すれば通る
    const ok = (async () => json({ access_token: 'AT', token_type: 'DPoP', refresh_token: 'RT', expires_in: 60, sub: 'did:plc:testserver' })) as unknown as typeof fetch;
    await expect(exchangeCode({ ...cfg(), fetchImpl: ok }, AS, 'C', 'V', 'https://pds.example', 'did:plc:testserver')).resolves.toMatchObject({ did: 'did:plc:testserver' });
  });

  it('bootstrap (exchangeCode) は sub 欠落を serverDid で埋めず拒否する', async () => {
    const f = (async () => json({ access_token: 'AT', token_type: 'DPoP', refresh_token: 'RT', expires_in: 60 })) as unknown as typeof fetch; // sub なし
    await expect(exchangeCode({ ...cfg(), fetchImpl: f }, AS, 'C', 'V', 'https://pds.example', 'did:plc:testserver')).rejects.toThrow(/sub/);
  });

  it('use_dpop_nonce チャレンジは nonce を付けて再送し成功する', async () => {
    let calls = 0;
    const f = (async (_u: string) => {
      calls++;
      if (calls === 1) return json({ error: 'use_dpop_nonce' }, 400, { 'DPoP-Nonce': 'N1' });
      return json({ access_token: 'AT', token_type: 'DPoP', refresh_token: 'RT', expires_in: 60, sub: 'did:plc:x' });
    }) as unknown as typeof fetch;
    const t = await exchangeCode({ ...cfg(), fetchImpl: f }, AS, 'C', 'V', 'https://pds.example', 'did:plc:x');
    expect(calls).toBe(2);
    expect(t.accessToken).toBe('AT');
  });

  it('OAuth エラー応答 (invalid_grant 等) は throw', async () => {
    const f = (async () => json({ error: 'invalid_grant', error_description: 'bad code' }, 400)) as unknown as typeof fetch;
    await expect(exchangeCode({ ...cfg(), fetchImpl: f }, AS, 'C', 'V', 'https://pds.example', 'did:plc:x')).rejects.toThrow(/invalid_grant/);
  });
});
