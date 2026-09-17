import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/router';
import { png, imageFixture, cidFor } from '../../../packages/core/src/__tests__/helpers/npc-images';
import type { NpcImage } from '@aozoraquest/core';

vi.mock('../src/service-auth', async (original) => ({ ...await original<typeof import('../src/service-auth')>(), resolveDidDocument: async (did: string) => (await fetch(`https://plc.directory/${did}`)).json() }));

const did = 'did:plc:npcimageauthor';
const env = { ADMIN_DIDS: did };
const bytes = png();
const cid = cidFor(bytes);
function fixture(options: { endpoint?: string; image?: unknown; body?: Uint8Array; contentType?: string; redirect?: boolean; missing?: boolean } = {}) {
  const image: NpcImage = { width: 32, height: 32, blob: { $type: 'blob', ref: { $link: cid }, mimeType: 'image/png', size: bytes.length } };
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('plc.directory')) return Response.json({ id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: options.endpoint ?? 'https://npc-author.example' }] });
    if (options.redirect) { expect(init?.redirect).toBe('error'); throw new Error('redirect blocked'); }
    if (url.includes('getRecord')) {
      expect(new URL(url).searchParams.get('repo')).toBe(did);
      return Response.json({ value: { npcs: options.missing ? [] : [{ id: 'npc-one', spriteImage: options.image ?? image, portraitImage: options.image ?? image }] } });
    }
    if (url.includes('getBlob')) return new Response(new Uint8Array(options.body ?? bytes).buffer, { headers: { 'content-type': options.contentType ?? 'image/png' } });
    throw new Error('unexpected URL');
  });
  vi.stubGlobal('fetch', f);
  return f;
}
function request(kind = 'sprite', requestedCid = cid) {
  return new Request(`https://edge.example/api/npc-image?${new URLSearchParams({ npcId: 'npc-one', kind, cid: requestedCid })}`);
}
afterEach(() => vi.unstubAllGlobals());
describe('GET /api/npc-image', () => {
  it('publicly serves only the primary author saved image, rechecking replacement/deletion', async () => {
    fixture();
    const response = await handleRequest(request(), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    fixture({ missing: true });
    expect((await handleRequest(request(), env)).status).toBe(404);
    fixture();
    expect((await handleRequest(request('sprite', cidFor(png(16, 16))), env)).status).toBe(404);
    expect((await handleRequest(request('portrait'), env)).status).toBe(200);
  });
  it('serves transparent WebP unchanged with its actual MIME type', async () => {
    const webp = imageFixture('32x32.webp');
    fixture({ body: webp, contentType: 'image/webp', image: { width: 32, height: 32, blob: { $type: 'blob', ref: { $link: cid }, mimeType: 'image/webp', size: webp.length } } });
    const response = await handleRequest(request(), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(webp);
  });
  it('rejects arbitrary sources, redirects, bad types, forged dimensions and oversized payloads', async () => {
    const f = fixture();
    expect((await handleRequest(request('sprite', 'https://evil.example'), env)).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
    for (const endpoint of ['https://127.0.0.1', 'http://npc-author.example', 'https://localhost', 'https://user:pass@npc-author.example', 'https://[::1]', 'https://npc-author.example:9443']) {
      const calls = fixture({ endpoint });
      expect((await handleRequest(request(), env)).status).toBe(502);
      expect(calls).toHaveBeenCalledTimes(1);
    }
    fixture({ redirect: true }); expect((await handleRequest(request(), env)).status).toBe(502);
    fixture({ contentType: 'image/svg+xml' }); expect((await handleRequest(request(), env)).status).toBe(422);
    fixture({ body: png(16, 16) }); expect((await handleRequest(request(), env)).status).toBe(422);
    const animated = imageFixture('animated.webp');
    fixture({ body: animated, contentType: 'image/webp', image: { width: 32, height: 32, blob: { $type: 'blob', ref: { $link: cid }, mimeType: 'image/webp', size: animated.length } } });
    expect((await handleRequest(request(), env)).status).toBe(502);
    fixture({ body: Buffer.alloc(102401) }); expect((await handleRequest(request(), env)).status).toBe(502);
  });
});
