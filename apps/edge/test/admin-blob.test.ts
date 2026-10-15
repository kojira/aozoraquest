/**
 * dev 専用の NPC 画像 blob 登録 (#699)。docs/issue-695-admin-data-api.md が正本。
 *   - 無効・鍵なし・鍵違いは通常の not_found と同じ 404 (存在を明かさない)
 *   - Content-Type 違い・規格外 (寸法・アニメ・kind 違い) は 400 で uploadBlob しない
 *   - 正常なら uploadBlob し、NPC レコードの画像欄と同じ形を返す
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { handleRequest, type Env } from '../src/router';
import { writeServerTokens } from '../src/oauth-store';
import { imageFixture, cidFor } from '../../../packages/core/src/__tests__/helpers/npc-images';

const ADMIN = 'did:plc:admin';
const PDS = 'https://pds.example';
const KEY = 'test-admin-data-key';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill), pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
async function makeEnv(extra: Partial<Env> = {}): Promise<Env> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: ADMIN, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: Math.floor(Date.now() / 1000) + 3600, pdsUrl: PDS, authServer: 'https://bsky.social', updatedAt: 0 });
  return { SERVER_DID: ADMIN, ADMIN_DIDS: ADMIN, OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), WORKER_DID: 'did:web:edge.aozoraquest.app',
    OAUTH_TOKENS: kv, ADMIN_DATA_API_ENABLED: '1', ADMIN_DATA_API_KEY: KEY, ...extra };
}
function post(kind: string, body: Uint8Array, opts: { key?: string | null; type?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': opts.type ?? 'image/webp' };
  if (opts.key !== null) headers.authorization = `Bearer ${opts.key ?? KEY}`;
  return new Request(`https://edge.test/api/admin/blob?kind=${kind}`, { method: 'POST', headers, body: Uint8Array.from(body).buffer });
}

describe('POST /api/admin/blob (#699)', () => {
  const orig = globalThis.fetch;
  const uploads: Array<{ type: string | null; size: number }> = [];
  const fakePds = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== `${PDS}/xrpc/com.atproto.repo.uploadBlob`) return json(404, { error: 'not_found' });
    const bytes = new Uint8Array(init.body as ArrayBuffer);
    uploads.push({ type: new Headers(init.headers).get('content-type'), size: bytes.length });
    return json(200, { blob: { $type: 'blob', ref: { $link: cidFor(bytes) }, mimeType: 'image/webp', size: bytes.length } });
  }) as unknown as typeof fetch;
  beforeAll(() => { globalThis.fetch = fakePds; });
  afterEach(() => { uploads.length = 0; });
  afterAll(() => { globalThis.fetch = orig; });

  it('無効・鍵なし・鍵違い・GET は通常の not_found と同じ 404', async () => {
    const webp = imageFixture('300x450.webp');
    for (const [env, req] of [
      [await makeEnv({ ADMIN_DATA_API_ENABLED: undefined }), post('portrait', webp)],
      [await makeEnv({ ADMIN_DATA_API_KEY: undefined }), post('portrait', webp)],
      [await makeEnv(), post('portrait', webp, { key: null })],
      [await makeEnv(), post('portrait', webp, { key: 'wrong' })],
      [await makeEnv(), new Request('https://edge.test/api/admin/blob?kind=portrait', { headers: { authorization: `Bearer ${KEY}` } })],
    ] as const) {
      const res = await handleRequest(req, env);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found', path: '/api/admin/blob' });
    }
    expect(uploads).toHaveLength(0);
  });

  it('型違い・kind 違い・規格外・アニメは 400 で uploadBlob しない', async () => {
    for (const req of [
      post('portrait', imageFixture('512x768.png'), { type: 'image/png' }),
      post('face', imageFixture('300x450.webp')),
      post('sprite', imageFixture('300x450.webp')),
      post('sprite', imageFixture('animated.webp')),
      post('portrait', imageFixture('512x768.png')),
    ]) {
      const res = await handleRequest(req, await makeEnv());
      expect(res.status).toBe(400);
    }
    expect(uploads).toHaveLength(0);
  });

  it('正常な WebP は uploadBlob し、NPC 画像欄と同じ形を返す', async () => {
    const webp = imageFixture('300x450.webp');
    const res = await handleRequest(post('portrait', webp), await makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kind: 'portrait', image: { width: 300, height: 450, blob: { $type: 'blob', ref: { $link: cidFor(webp) }, mimeType: 'image/webp', size: webp.length } } });
    expect(uploads).toEqual([{ type: 'image/webp', size: webp.length }]);
  });
});
