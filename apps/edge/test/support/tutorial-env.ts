import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { writeServerTokens } from '../../src/oauth-store';
import type { GameStateEnv } from '../../src/game-state';

/** Isolated browser acceptance credentials. No real key/token/KV is read. */
export async function tutorialEnv(now: number): Promise<GameStateEnv> {
  function jwk(fill: number) {
    const d = new Uint8Array(32).fill(fill), pub = p256.getPublicKey(d, false);
    return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33)), d: base64urlnopad.encode(d), kid: `k${fill}` });
  }
  const records = new Map<string, string>();
  const kv = { get: async (k: string) => records.get(k) ?? null, put: async (k: string, v: string) => { records.set(k, v); }, delete: async (k: string) => { records.delete(k); } } as unknown as KVNamespace;
  const env = { SERVER_DID: 'did:plc:fixture', WORKER_DID: 'did:web:fixture.invalid', OAUTH_CLIENT_PRIVATE_JWK: jwk(3), OAUTH_DPOP_PRIVATE_JWK: jwk(5), OAUTH_TOKENS: kv };
  await writeServerTokens(kv, { did: env.SERVER_DID, accessToken: 'fixture', refreshToken: 'fixture', tokenType: 'DPoP', expiresAt: now + 3600, pdsUrl: 'https://pds.fixture.invalid', authServer: 'https://auth.fixture.invalid', updatedAt: now });
  return env;
}
