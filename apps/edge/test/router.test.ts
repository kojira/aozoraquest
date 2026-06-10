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

  it('/probe/oauth は default で 404 (production の cold start 防止)', async () => {
    const res = await handleRequest(new Request('https://x/probe/oauth'), env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('probe_disabled');
  });

  it('/probe/oauth は ENABLE_OAUTH_PROBE=1 でのみ実行 (= dev 用)', async () => {
    const probeEnv: Env = { ENABLE_OAUTH_PROBE: '1' };
    const res = await handleRequest(new Request('https://x/probe/oauth'), probeEnv);
    // 結果は ok / not ok いずれもあるが 404 ではない
    expect(res.status).not.toBe(404);
  });
});
