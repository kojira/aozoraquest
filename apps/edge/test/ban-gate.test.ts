import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * **BAN 済み DID はワールドの権威 API を 403 で弾く** (#561)。
 *
 * BAN リストは管理者 PDS の `config.bans` (rkey=self) を、手編集の世界と同じ loader
 * (`ensureAuthoredWorld`) で読む。ここでは JWT 検証と PDS 読み取りだけ差し替え、
 * ルーター → authenticate → loader → core の isBanned という本番の経路をそのまま通す。
 */

const BANNED = 'did:plc:banned';
const ADMIN = 'did:plc:admin';
const BANS_COLLECTION = 'app.aozoraquest.config.bans';

// vi.mock はファイル先頭へ巻き上げられるので、factory が触る値は vi.hoisted で先に作る。
const h = vi.hoisted(() => {
  const state = {
    /** 呼び出し元 DID (JWT の iss)。テストごとに差し替える。 */
    caller: 'did:plc:banned',
    /** 管理者 PDS にある BAN レコードの中身。null = レコード無し。 */
    bansRecord: null as { dids: string[]; updatedAt: string } | null,
  };
  const getRecordMock = vi.fn(async (_pds: string, _repo: string, collection: string, rkey: string) => {
    if (collection === 'app.aozoraquest.config.bans' && rkey === 'self' && state.bansRecord) {
      return { uri: 'at://x', cid: 'c', value: state.bansRecord };
    }
    return null;
  });
  return { state, getRecordMock };
});

vi.mock('../src/service-auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/service-auth')>();
  return {
    ...mod,
    verifyServiceAuth: vi.fn(async () => ({ iss: h.state.caller })),
    resolveDidDocument: vi.fn(async (did: string) => ({
      id: did,
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }],
    })),
  };
});
vi.mock('../src/pds', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/pds')>();
  return { ...mod, getRecord: h.getRecordMock };
});

import { handleRequest, type Env } from '../src/router';
import { resetAuthoredWorldCache } from '../src/world-authoring';

const env: Env = { ENVIRONMENT: 'test', ADMIN_DIDS: ADMIN };

function post(path: string, body: unknown = {}): Request {
  return new Request(`https://x${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test.jwt', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function get(path: string): Request {
  return new Request(`https://x${path}`, { headers: { authorization: 'Bearer test.jwt' } });
}

beforeEach(() => {
  resetAuthoredWorldCache();
  h.getRecordMock.mockClear();
  h.state.caller = BANNED;
  h.state.bansRecord = { dids: [BANNED], updatedAt: new Date(0).toISOString() };
});

describe('BAN ゲート (ワールドの権威 API)', () => {
  it('BAN 済み DID の移動は 403 forbidden/banned', async () => {
    const res = await handleRequest(post('/api/world/move', { dx: 1, dy: 0 }), env);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden', reason: 'banned' });
  });

  it('BAN リストは管理者 PDS の config.bans (rkey=self) から読む', async () => {
    await handleRequest(post('/api/world/move', { dx: 1, dy: 0 }), env);
    expect(h.getRecordMock).toHaveBeenCalledWith('https://pds.example', ADMIN, BANS_COLLECTION, 'self');
  });

  it.each([
    ['/api/battle/turn', { battleId: 'b', turn: 1, command: 'attack' }],
    ['/api/world/teleport', { x: 1, y: 1 }],
    ['/api/world/item', { item: 'herb' }],
    ['/api/world/gear', { gear: {} }],
    ['/api/world/search', {}],
    ['/api/world/reset', {}],
    ['/api/xp/claim', { archetype: 'a', postUri: 'at://x' }],
    ['/api/power/spend', { reason: 'card-draw', key: 'k' }],
    ['/api/shop/craft', { itemId: 'i', rkey: 'r' }],
    ['/api/shop/sell', { materialId: 'm', count: 1, rkey: 'r' }],
    ['/api/shop/forge', { rkeys: ['a', 'b'], rkey: 'r' }],
    ['/api/shop/discard', { rkeys: ['a'], rkey: 'r' }],
    ['/api/quest/accept', { questId: 'q' }],
    ['/api/quest/complete', { questId: 'q' }],
  ])('BAN 済み DID の %s は 403', async (path, body) => {
    const res = await handleRequest(post(path, body), env);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden', reason: 'banned' });
  });

  it('BAN リストが空なら通る (403 にならない)', async () => {
    h.state.bansRecord = { dids: [], updatedAt: new Date(0).toISOString() };
    const res = await handleRequest(post('/api/world/move', { dx: 1, dy: 0 }), env);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('BAN レコードが無ければ誰も BAN されない', async () => {
    h.state.bansRecord = null;
    const res = await handleRequest(post('/api/world/move', { dx: 1, dy: 0 }), env);
    expect(res.status).not.toBe(403);
  });

  it('リストに無い DID は通る', async () => {
    h.state.caller = 'did:plc:someone';
    const res = await handleRequest(post('/api/world/move', { dx: 1, dy: 0 }), env);
    expect(res.status).not.toBe(403);
  });

  it('BAN はワールドだけ: whoami と me/state (表示用の読み取り) は止めない', async () => {
    const who = await handleRequest(post('/api/whoami'), env);
    expect(who.status).toBe(200);
    expect(await who.json()).toEqual({ did: BANNED });
    const state = await handleRequest(get('/api/me/state'), env);
    expect(state.status).not.toBe(403);
  });

  it('同じ isolate では 2 回目以降も読み直さない (TTL キャッシュに乗る)', async () => {
    await handleRequest(post('/api/world/move', { dx: 1, dy: 0 }), env);
    const calls = h.getRecordMock.mock.calls.length;
    const res = await handleRequest(post('/api/world/move', { dx: 1, dy: 0 }), env);
    expect(res.status).toBe(403);
    expect(h.getRecordMock.mock.calls.length).toBe(calls);
  });
});
