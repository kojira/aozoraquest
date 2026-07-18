import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { getServerSession, withServerAuth, __resetServerSession, ServerConfigError, type ServerAuthEnv } from '../src/server-session';
import { PdsError, type PdsSession } from '../src/pds';

const env: ServerAuthEnv = { SERVER_PDS_URL: 'https://pds.example', SERVER_HANDLE: 'game.bsky.social', SERVER_APP_PASSWORD: 'app-pass' };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

describe('server-session', () => {
  const orig = globalThis.fetch;
  beforeEach(() => __resetServerSession());
  afterEach(() => { globalThis.fetch = orig; __resetServerSession(); });

  it('認証情報が欠けていれば ServerConfigError (fail-closed)', async () => {
    await expect(getServerSession({})).rejects.toBeInstanceOf(ServerConfigError);
    await expect(getServerSession({ SERVER_PDS_URL: 'x', SERVER_HANDLE: 'y' })).rejects.toBeInstanceOf(ServerConfigError);
  });

  it('createSession は 1 回だけ呼ばれ、以後はキャッシュを返す', async () => {
    let creates = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('createSession')) { creates++; return json(200, { accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:server' }); }
      return json(404, {});
    }) as unknown as typeof fetch;
    const s1 = await getServerSession(env);
    const s2 = await getServerSession(env);
    expect(s1).toBe(s2);
    expect(creates).toBe(1);
  });

  it('withServerAuth: 正常時は op を 1 回だけ実行', async () => {
    globalThis.fetch = (async () => json(200, { accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:server' })) as unknown as typeof fetch;
    let opCalls = 0;
    const r = await withServerAuth(env, async (s: PdsSession) => { opCalls++; expect(s.accessJwt).toBe('A1'); return 'ok'; });
    expect(r).toBe('ok');
    expect(opCalls).toBe(1);
  });

  it('withServerAuth: ExpiredToken なら refresh して 1 回リトライ', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes('createSession')) return json(200, { accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:server' });
      if (url.includes('refreshSession')) return json(200, { accessJwt: 'A2', refreshJwt: 'R2', did: 'did:plc:server' });
      return json(404, {});
    }) as unknown as typeof fetch;
    let opCalls = 0;
    const r = await withServerAuth(env, async (s: PdsSession) => {
      opCalls++;
      if (s.accessJwt === 'A1') throw new PdsError('expired', 400, 'ExpiredToken');
      return s.accessJwt; // 2 回目は refresh 後の A2
    });
    expect(r).toBe('A2');
    expect(opCalls).toBe(2);
  });

  it('withServerAuth: refresh も失敗したら再ログインしてリトライ', async () => {
    let creates = 0;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('createSession')) { creates++; return json(200, { accessJwt: `A${creates}`, refreshJwt: 'R', did: 'did:plc:server' }); }
      if (url.includes('refreshSession')) return json(400, { error: 'ExpiredToken' }); // refresh も失効
      return json(404, {});
    }) as unknown as typeof fetch;
    let opCalls = 0;
    const r = await withServerAuth(env, async (s: PdsSession) => {
      opCalls++;
      if (s.accessJwt === 'A1') throw new PdsError('expired', 401);
      return s.accessJwt; // 再ログイン後の A2
    });
    expect(r).toBe('A2');
    expect(opCalls).toBe(2);
    expect(creates).toBe(2);
  });

  it('withServerAuth: 認証以外のエラーはリトライせず即 throw', async () => {
    globalThis.fetch = (async () => json(200, { accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:server' })) as unknown as typeof fetch;
    let opCalls = 0;
    await expect(withServerAuth(env, async () => { opCalls++; throw new PdsError('conflict', 409, 'InvalidSwap'); })).rejects.toMatchObject({ xrpcError: 'InvalidSwap' });
    expect(opCalls).toBe(1);
  });

  it('withServerAuth: リトライ後も失効なら throw (無限ループしない)', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes('createSession')) return json(200, { accessJwt: 'A1', refreshJwt: 'R1', did: 'did:plc:server' });
      if (url.includes('refreshSession')) return json(200, { accessJwt: 'A2', refreshJwt: 'R2', did: 'did:plc:server' });
      return json(404, {});
    }) as unknown as typeof fetch;
    let opCalls = 0;
    await expect(withServerAuth(env, async () => { opCalls++; throw new PdsError('expired', 401); })).rejects.toBeInstanceOf(PdsError);
    expect(opCalls).toBe(2); // 初回 + リトライ 1 回で打ち止め
  });
});
