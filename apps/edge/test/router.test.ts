import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { base58, base64urlnopad } from '@scure/base';
import { describe, it, expect } from 'vitest';
import { handleRequest, type Env } from '../src/router';

const env: Env = { ENVIRONMENT: 'test' };

function reqWithOrigin(url: string, origin = 'https://aozoraquest.app', method = 'GET'): Request {
  return new Request(url, { method, headers: { origin } });
}

describe('edge router', () => {
  it('GET /healthz returns 200 + ok:true', async () => {
    const res = await handleRequest(new Request('https://x/healthz'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
  });

  it('GET /version returns name + phase + commit', async () => {
    const res = await handleRequest(new Request('https://x/version'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; phase: number; commit: string };
    expect(body).toMatchObject({ name: 'aozoraquest-edge', phase: 1 });
    expect(typeof body.commit).toBe('string');
  });

  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await handleRequest(reqWithOrigin('https://x/healthz', 'https://aozoraquest.app', 'OPTIONS'), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('unknown path returns 404 with not_found', async () => {
    const res = await handleRequest(new Request('https://x/nope'), env);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'not_found' });
  });

  it('responses are JSON content-type', async () => {
    const res = await handleRequest(new Request('https://x/healthz'), env);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('Origin allowed (aozoraquest.app) → ACAO 反射', async () => {
    const res = await handleRequest(reqWithOrigin('https://x/healthz', 'https://aozoraquest.app'), env);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://aozoraquest.app');
  });

  it('Origin not allowed → ACAO ヘッダなし', async () => {
    const res = await handleRequest(reqWithOrigin('https://x/healthz', 'https://evil.example.com'), env);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('ALLOWED_ORIGINS env で動的に許可セットを切り替えられる', async () => {
    const customEnv: Env = { ALLOWED_ORIGINS: 'https://my-fork.example' };
    const ok = await handleRequest(reqWithOrigin('https://x/healthz', 'https://my-fork.example'), customEnv);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://my-fork.example');
    const ng = await handleRequest(reqWithOrigin('https://x/healthz', 'https://aozoraquest.app'), customEnv);
    expect(ng.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('POST /api/whoami は JWT 無しなら 401', async () => {
    const res = await handleRequest(new Request('https://x/api/whoami', { method: 'POST' }), env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_token');
  });

  it('POST /api/whoami は不正 JWT なら 401 (fail-closed)', async () => {
    const res = await handleRequest(
      new Request('https://x/api/whoami', { method: 'POST', headers: { authorization: 'Bearer not.a.jwt' } }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/me/state は JWT 無しなら 401', async () => {
    const res = await handleRequest(new Request('https://x/api/me/state'), env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('missing_token');
  });

  it('GET /client-metadata.json は OAuth 未設定なら 503', async () => {
    const res = await handleRequest(new Request('https://x/client-metadata.json'), env);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('oauth_not_configured');
  });

  it('POST /api/oauth/start は OAuth 未設定 (KV 無し) なら 503', async () => {
    const res = await handleRequest(new Request('https://x/api/oauth/start', { method: 'POST' }), env);
    expect(res.status).toBe(503);
  });

  it('POST /api/world/move は JWT 無しなら 401 (移動も毎回 Worker 認証)', async () => {
    const res = await handleRequest(new Request('https://x/api/world/move', { method: 'POST' }), env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('missing_token');
  });

  it('POST /api/battle/turn は JWT 無しなら 401', async () => {
    const res = await handleRequest(new Request('https://x/api/battle/turn', { method: 'POST' }), env);
    expect(res.status).toBe(401);
  });

  it('GET /oauth/callback は code 欠落なら 400 (HTML)', async () => {
    const res = await handleRequest(new Request('https://x/oauth/callback'), env);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
  });
});


it('quest routes require their own auth scope and explicit string questId, never selecting a default', async () => {
  const original = globalThis.fetch;
  const did = 'did:plc:quest-router', aud = 'did:web:edge.aozoraquest.app';
  const priv = new Uint8Array(32).fill(7);
  const pub = p256.getPublicKey(priv, true);
  const encode = (value: unknown) => base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(value)));
  const tokenFor = (lxm: string) => {
    const content = `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({ iss: did, aud, lxm, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 })}`;
    return `${content}.${base64urlnopad.encode(p256.sign(sha256(new TextEncoder().encode(content)), priv, { lowS: true }).toCompactRawBytes())}`;
  };
  let writes = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') writes++;
    if (!url.includes('plc.directory')) throw new Error('unexpected external request');
    return Response.json({ id: did, verificationMethod: [{ id: `${did}#atproto`, type: 'Multikey', publicKeyMultibase: 'z' + base58.encode(new Uint8Array([0x80, 0x24, ...pub])) }] });
  }) as typeof fetch;
  try {
    for (const action of ['accept', 'complete']) {
      const request = (token: string | undefined, body: unknown) => new Request(`https://x/api/quest/${action}`, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect((await handleRequest(request(undefined, { questId: 'b' }), env)).status).toBe(401);
      expect((await handleRequest(request(tokenFor('wrong.scope'), { questId: 'b' }), env)).status).toBe(401);
      for (const body of [{}, { questId: 1 }]) {
        const res = await handleRequest(request(tokenFor(`app.aozoraquest.quest.${action}`), body), env);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'bad_request' });
      }
    }
    expect(writes).toBe(0);
  } finally { globalThis.fetch = original; }
});

describe('GET /api/world/admin-cache (D-MONSTER-001)', () => {
  const stored = JSON.stringify({ cid: 'bafy-monsters', value: { monsters: [{ id: 'slime' }], updatedAt: 'x' } });
  const kv = (data: Record<string, string>) =>
    ({ get: async (k: string) => data[k] ?? null, put: async () => {}, delete: async () => {} }) as unknown as KVNamespace;
  const withKv: Env = { ADMIN_NSID_ENV: 'dev', OAUTH_TOKENS: kv({ 'admin-world:app.aozoraquest.dev:monsters': stored }) };

  it('KV に値があれば 200 で同じ JSON をそのまま返す (認証なし)', async () => {
    const res = await handleRequest(reqWithOrigin('https://x/api/world/admin-cache?name=monsters', 'https://dev.aozoraquest.app'), withKv);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(stored);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://dev.aozoraquest.app');
  });

  it('KV に値が無ければ 404', async () => {
    const res = await handleRequest(new Request('https://x/api/world/admin-cache?name=monsters'), { OAUTH_TOKENS: kv({}) });
    expect(res.status).toBe(404);
  });

  it('monsterArt も KV の値をそのまま返す (D-MONSTER-001 PR2)', async () => {
    const art = JSON.stringify({ cid: 'bafy-art', value: { arts: [{ id: 'slime', svg: '<g/>' }] } });
    const res = await handleRequest(new Request('https://x/api/world/admin-cache?name=monsterArt'), { OAUTH_TOKENS: kv({ 'admin-world:app.aozoraquest:monsterArt': art }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(art);
  });

  it('monsters / monsterArt 以外の name は KV に値があっても 404', async () => {
    const leaky: Env = { OAUTH_TOKENS: kv({ 'admin-world:app.aozoraquest:npcs': '{}', 'pds:usage': '{}' }) };
    for (const name of ['npcs', 'pds:usage', '', '../monsters']) {
      const res = await handleRequest(new Request(`https://x/api/world/admin-cache?name=${encodeURIComponent(name)}`), leaky);
      expect(res.status).toBe(404);
    }
    const none = await handleRequest(new Request('https://x/api/world/admin-cache'), leaky);
    expect(none.status).toBe(404);
  });
});
