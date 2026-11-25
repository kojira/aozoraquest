import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureAtprotoEndpoints } from '../src/atproto-endpoints';
import { resolveDidDocument } from '../src/service-auth';
import { discoverAuthServer, pdsEndpointFromDoc } from '../src/oauth-metadata';

/**
 * 外部つなぎ先の差し替え (#1018)。核心は「**未設定なら本物の Bluesky のまま** (plc.directory、
 * https だけ)」と「ローカル環境で設定したらそちらを使う」。
 */
const DID = 'did:plc:localtest';
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

describe('atproto-endpoints (edge)', () => {
  afterEach(() => configureAtprotoEndpoints({}));

  it('未設定なら did:plc は plc.directory で解決する', async () => {
    configureAtprotoEndpoints({});
    const f = vi.fn(async () => json({ id: DID })) as unknown as typeof fetch;
    await resolveDidDocument(DID, f);
    expect(f).toHaveBeenCalledWith(`https://plc.directory/${encodeURIComponent(DID)}`);
  });

  it('PLC_DIRECTORY_URL を設定するとそちらで解決する', async () => {
    configureAtprotoEndpoints({ PLC_DIRECTORY_URL: 'http://localhost:2582/' });
    const f = vi.fn(async () => json({ id: DID })) as unknown as typeof fetch;
    await resolveDidDocument(DID, f);
    expect(f).toHaveBeenCalledWith(`http://localhost:2582/${encodeURIComponent(DID)}`);
  });

  it('未設定なら http の PDS は拒否 (既定の挙動は変わらない)', () => {
    configureAtprotoEndpoints({});
    const doc = { id: DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'http://localhost:2583' }] };
    expect(() => pdsEndpointFromDoc(doc, DID)).toThrow();
  });

  it('ALLOW_LOOPBACK_HTTP=1 なら loopback の http PDS だけ許す', () => {
    configureAtprotoEndpoints({ ALLOW_LOOPBACK_HTTP: '1' });
    const doc = (ep: string) => ({ id: DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: ep }] });
    expect(pdsEndpointFromDoc(doc('http://localhost:2583'), DID)).toBe('http://localhost:2583');
    expect(pdsEndpointFromDoc(doc('http://127.0.0.1:2583/'), DID)).toBe('http://127.0.0.1:2583');
    expect(() => pdsEndpointFromDoc(doc('http://pds.example'), DID)).toThrow();
    expect(() => pdsEndpointFromDoc(doc('http://10.0.0.1:2583'), DID)).toThrow();
  });

  it('ALLOW_LOOPBACK_HTTP=1 なら loopback の http 認可サーバーを使える / 未設定なら拒否', async () => {
    const AS = 'http://localhost:2583';
    const f = (async (url: string) => url.includes('oauth-protected-resource')
      ? json({ authorization_servers: [AS] })
      : json({ issuer: AS, authorization_endpoint: `${AS}/oauth/authorize`, token_endpoint: `${AS}/oauth/token`, pushed_authorization_request_endpoint: `${AS}/oauth/par` })) as unknown as typeof fetch;
    configureAtprotoEndpoints({});
    await expect(discoverAuthServer(AS, f)).rejects.toThrow();
    configureAtprotoEndpoints({ ALLOW_LOOPBACK_HTTP: '1' });
    expect((await discoverAuthServer(AS, f)).issuer).toBe(AS);
  });
});
