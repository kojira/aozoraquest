import { describe, it, expect } from 'vitest';
import { pdsEndpointFromDoc, discoverAuthServer, discoverForDid, type AuthServerMetadata } from '../src/oauth-metadata';

const DID = 'did:plc:server';
const PDS = 'https://pds.example';
const AS = 'https://bsky.social';

const goodMeta: AuthServerMetadata = {
  issuer: AS,
  authorization_endpoint: `${AS}/oauth/authorize`,
  token_endpoint: `${AS}/oauth/token`,
  pushed_authorization_request_endpoint: `${AS}/oauth/par`,
  dpop_signing_alg_values_supported: ['ES256', 'RS256'],
};

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

/** URL に応じて用意した応答を返す fetch モック。 */
function mock(routes: Record<string, () => Response>) {
  return (async (url: string) => {
    for (const [frag, fn] of Object.entries(routes)) if (url.includes(frag)) return fn();
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
}

describe('oauth-metadata', () => {
  it('pdsEndpointFromDoc は #atproto_pds を取り出す (id / 完全 id / type いずれでも)', () => {
    expect(pdsEndpointFromDoc({ id: DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.a/' }] }, DID)).toBe('https://pds.a');
    expect(pdsEndpointFromDoc({ id: DID, service: [{ id: `${DID}#atproto_pds`, type: 'X', serviceEndpoint: 'https://pds.b' }] }, DID)).toBe('https://pds.b');
    expect(pdsEndpointFromDoc({ id: DID, service: [{ id: '#other', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.c' }] }, DID)).toBe('https://pds.c');
  });

  it('pdsEndpointFromDoc は無い / http (非https) を弾く', () => {
    expect(() => pdsEndpointFromDoc({ id: DID, service: [] }, DID)).toThrow();
    expect(() => pdsEndpointFromDoc({ id: DID, service: [{ id: '#atproto_pds', type: 'X', serviceEndpoint: 'http://insecure' }] }, DID)).toThrow();
  });

  it('discoverAuthServer は protected-resource → メタデータを解決する', async () => {
    const f = mock({
      'oauth-protected-resource': () => json({ authorization_servers: [AS] }),
      'oauth-authorization-server': () => json(goodMeta),
    });
    const meta = await discoverAuthServer(PDS, f);
    expect(meta.issuer).toBe(AS);
    expect(meta.pushed_authorization_request_endpoint).toBe(`${AS}/oauth/par`);
  });

  it('issuer 不一致 (mix-up) は弾く', async () => {
    const f = mock({
      'oauth-protected-resource': () => json({ authorization_servers: [AS] }),
      'oauth-authorization-server': () => json({ ...goodMeta, issuer: 'https://evil.example' }),
    });
    await expect(discoverAuthServer(PDS, f)).rejects.toThrow(/issuer/);
  });

  it('PAR エンドポイントが無ければ弾く (AT Proto 必須)', async () => {
    const { pushed_authorization_request_endpoint, ...noPar } = goodMeta;
    const f = mock({
      'oauth-protected-resource': () => json({ authorization_servers: [AS] }),
      'oauth-authorization-server': () => json(noPar),
    });
    await expect(discoverAuthServer(PDS, f)).rejects.toThrow(/PAR/);
  });

  it('DPoP ES256 非対応は弾く', async () => {
    const f = mock({
      'oauth-protected-resource': () => json({ authorization_servers: [AS] }),
      'oauth-authorization-server': () => json({ ...goodMeta, dpop_signing_alg_values_supported: ['RS256'] }),
    });
    await expect(discoverAuthServer(PDS, f)).rejects.toThrow(/DPoP/);
  });

  it('authorization_servers が無ければ弾く', async () => {
    const f = mock({ 'oauth-protected-resource': () => json({}) });
    await expect(discoverAuthServer(PDS, f)).rejects.toThrow(/authorization_servers/);
  });

  it('discoverForDid は DID→PDS→認可サーバーまで一括解決', async () => {
    const f = mock({
      'plc.directory': () => json({ id: DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] }),
      'oauth-protected-resource': () => json({ authorization_servers: [AS] }),
      'oauth-authorization-server': () => json(goodMeta),
    });
    const r = await discoverForDid(DID, f);
    expect(r.pdsUrl).toBe(PDS);
    expect(r.authServer.token_endpoint).toBe(`${AS}/oauth/token`);
  });
});
