import { describe, it, expect } from 'vitest';
import { createSession, getRecord, putRecord, PdsError, type PdsSession } from '../src/pds';

/** fetch をモックして、送られたリクエストを記録しつつ用意した応答を返す。 */
function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const PDS = 'https://pds.example';
const session: PdsSession = { pdsUrl: PDS, accessJwt: 'ACCESS', refreshJwt: 'REFRESH', did: 'did:plc:server' };

describe('PDS クライアント (fetch ベース XRPC)', () => {
  it('createSession は identifier/password を POST し did/jwt を返す', async () => {
    const { fn, calls } = mockFetch(() => ({ status: 200, body: { accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:server' } }));
    const orig = globalThis.fetch;
    globalThis.fetch = fn;
    try {
      const s = await createSession(PDS, 'game.bsky.social', 'app-pass');
      expect(s.did).toBe('did:plc:server');
      expect(s.accessJwt).toBe('A');
      expect(calls[0]!.url).toBe(`${PDS}/xrpc/com.atproto.server.createSession`);
      expect(calls[0]!.init.method).toBe('POST');
      expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ identifier: 'game.bsky.social', password: 'app-pass' });
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('getRecord は value+cid を返し、RecordNotFound(400) は null', async () => {
    const orig = globalThis.fetch;
    // 存在するケース
    let m = mockFetch(() => ({ status: 200, body: { uri: 'at://x', cid: 'CID1', value: { hp: 10 } } }));
    globalThis.fetch = m.fn;
    try {
      const r = await getRecord<{ hp: number }>(PDS, 'did:plc:server', 'app.aozoraquest.gameState', 'user1');
      expect(r?.value.hp).toBe(10);
      expect(r?.cid).toBe('CID1');
      expect(m.calls[0]!.url).toContain('com.atproto.repo.getRecord?');
      expect(m.calls[0]!.url).toContain('rkey=user1');
      // 存在しないケース
      m = mockFetch(() => ({ status: 400, body: { error: 'RecordNotFound', message: 'nope' } }));
      globalThis.fetch = m.fn;
      expect(await getRecord(PDS, 'did:plc:server', 'c', 'missing')).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('putRecord は repo=session.did + auth header + swapRecord(CAS) を送る', async () => {
    const orig = globalThis.fetch;
    const m = mockFetch(() => ({ status: 200, body: { uri: 'at://x', cid: 'CID2' } }));
    globalThis.fetch = m.fn;
    try {
      const res = await putRecord(session, 'app.aozoraquest.gameState', 'user1', { hp: 5 }, 'OLDCID');
      expect(res.cid).toBe('CID2');
      const sent = JSON.parse(m.calls[0]!.init.body as string);
      expect(sent).toEqual({ repo: 'did:plc:server', collection: 'app.aozoraquest.gameState', rkey: 'user1', record: { hp: 5 }, swapRecord: 'OLDCID' });
      expect((m.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer ACCESS');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('swapRecord=null は「新規作成のみ」を意味する (既存なら InvalidSwap)', async () => {
    const orig = globalThis.fetch;
    const m = mockFetch(() => ({ status: 200, body: { uri: 'x', cid: 'C' } }));
    globalThis.fetch = m.fn;
    try {
      await putRecord(session, 'c', 'rk', { a: 1 }, null);
      expect(JSON.parse(m.calls[0]!.init.body as string).swapRecord).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('CAS 競合 (InvalidSwap) は PdsError.xrpcError で判別できる', async () => {
    const orig = globalThis.fetch;
    const m = mockFetch(() => ({ status: 400, body: { error: 'InvalidSwap', message: 'CID mismatch' } }));
    globalThis.fetch = m.fn;
    try {
      await expect(putRecord(session, 'c', 'rk', { a: 1 }, 'STALE')).rejects.toMatchObject({ xrpcError: 'InvalidSwap' });
    } finally {
      globalThis.fetch = orig;
    }
  });
});
