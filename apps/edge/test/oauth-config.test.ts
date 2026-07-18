import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { loadOAuthConfig, publicOrigin, isEdgeAdmin, buildClientMetadata, OAuthConfigError, type OAuthEnv } from '../src/oauth-config';

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
const baseEnv = (): OAuthEnv => ({
  OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3),
  OAUTH_DPOP_PRIVATE_JWK: jwkJson(5),
  SERVER_DID: 'did:plc:kojira',
  WORKER_DID: 'did:web:edge.aozoraquest.app',
  ADMIN_DIDS: 'did:plc:admin1, did:plc:admin2',
});

describe('oauth-config', () => {
  it('publicOrigin は WORKER_DID(did:web) から導出 / PUBLIC_ORIGIN 優先', () => {
    expect(publicOrigin({ WORKER_DID: 'did:web:edge.aozoraquest.app' })).toBe('https://edge.aozoraquest.app');
    expect(publicOrigin({ PUBLIC_ORIGIN: 'https://x.example/', WORKER_DID: 'did:web:y' })).toBe('https://x.example');
    expect(() => publicOrigin({})).toThrow(OAuthConfigError);
  });

  it('loadOAuthConfig は client_id/redirect を導出し鍵を読む', () => {
    const c = loadOAuthConfig(baseEnv());
    expect(c.clientId).toBe('https://edge.aozoraquest.app/client-metadata.json');
    expect(c.redirectUri).toBe('https://edge.aozoraquest.app/oauth/callback');
    expect(c.scope).toBe('atproto transition:generic');
    expect(c.serverDid).toBe('did:plc:kojira');
    expect(c.clientJwk.d).toBeTruthy();
  });

  it('SERVER_DID / 鍵の欠落・不正は OAuthConfigError (fail-closed)', () => {
    expect(() => loadOAuthConfig({ ...baseEnv(), SERVER_DID: undefined })).toThrow(OAuthConfigError);
    expect(() => loadOAuthConfig({ ...baseEnv(), OAUTH_CLIENT_PRIVATE_JWK: undefined })).toThrow(OAuthConfigError);
    expect(() => loadOAuthConfig({ ...baseEnv(), OAUTH_DPOP_PRIVATE_JWK: '{bad json' })).toThrow(OAuthConfigError);
    expect(() => loadOAuthConfig({ ...baseEnv(), OAUTH_CLIENT_PRIVATE_JWK: JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }) })).toThrow(/秘密鍵/);
  });

  it('isEdgeAdmin は ADMIN_DIDS 許可リストで判定', () => {
    const env = baseEnv();
    expect(isEdgeAdmin(env, 'did:plc:admin1')).toBe(true);
    expect(isEdgeAdmin(env, 'did:plc:admin2')).toBe(true);
    expect(isEdgeAdmin(env, 'did:plc:other')).toBe(false);
    expect(isEdgeAdmin({}, 'did:plc:admin1')).toBe(false);
  });

  it('buildClientMetadata は confidential client (private_key_jwt + 公開 jwks)', () => {
    const m = buildClientMetadata(loadOAuthConfig(baseEnv()));
    expect(m.client_id).toBe('https://edge.aozoraquest.app/client-metadata.json');
    expect(m.redirect_uris).toEqual(['https://edge.aozoraquest.app/oauth/callback']);
    expect(m.token_endpoint_auth_method).toBe('private_key_jwt');
    expect(m.dpop_bound_access_tokens).toBe(true);
    const keys = (m.jwks as { keys: Record<string, unknown>[] }).keys;
    expect(keys[0]!.d).toBeUndefined(); // 公開鍵のみ (秘密鍵を晒さない)
    expect(keys[0]!.kid).toBe('k3');
    expect(keys[0]!.use).toBe('sig');
  });
});
