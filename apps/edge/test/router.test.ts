import { describe, it, expect } from 'vitest';
import { handleRequest, type Env } from '../src/router';

const env: Env = { ENVIRONMENT: 'test' };

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
    const res = await handleRequest(new Request('https://x/healthz', { method: 'OPTIONS' }), env);
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

  it('CORS origin is set on response', async () => {
    const res = await handleRequest(new Request('https://x/healthz'), env);
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });
});
