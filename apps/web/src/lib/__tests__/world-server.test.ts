import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Agent } from '@atproto/api';

/** exp 付きの偽 JWT (キャッシュ用に exp を読ませる)。 */
function fakeJwt(exp: number): string {
  return `h.${btoa(JSON.stringify({ exp }))}.s`;
}
/** getServiceAuth をカウントするモック agent。 */
function mockAgent(exp: number) {
  let calls = 0;
  const agent = { com: { atproto: { server: { getServiceAuth: async () => { calls++; return { data: { token: fakeJwt(exp) } }; } } } } } as unknown as Agent;
  return { agent, calls: () => calls };
}

describe('world-server (サーバー権威 API クライアント)', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_EDGE_URL', 'https://edge.test');
    vi.stubEnv('VITE_EDGE_DID', 'did:web:edge.test');
  });
  afterEach(() => { globalThis.fetch = origFetch; vi.unstubAllEnvs(); });

  it('serverMove: Bearer + {dx,dy} を /api/world/move に POST し結果を返す', async () => {
    const { serverMove } = await import('../world-server');
    const { agent } = mockAgent(Date.now() / 1000 + 300);
    let seen: { url: string; headers: Headers; body: unknown } | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers), body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ x: 3, y: 4, terrain: 'plains' }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await serverMove(agent, 1, 0);
    expect(r).toMatchObject({ x: 3, y: 4, terrain: 'plains' });
    expect(seen!.url).toBe('https://edge.test/api/world/move');
    expect(seen!.headers.get('authorization')).toMatch(/^Bearer /);
    expect(seen!.body).toEqual({ dx: 1, dy: 0 });
  });

  it('serverTurn: /api/battle/turn に POST', async () => {
    const { serverTurn } = await import('../world-server');
    const { agent } = mockAgent(Date.now() / 1000 + 300);
    let body: unknown;
    globalThis.fetch = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ state: {}, events: [], outcome: 'ongoing' }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await serverTurn(agent, 'btl-1', 2, 'attack');
    expect(r.outcome).toBe('ongoing');
    expect(body).toEqual({ battleId: 'btl-1', turn: 2, command: 'attack' });
  });

  it('quest DTOs carry full arrays and route only the chosen ID with distinct auth scopes', async () => {
    const { serverQuestAccept, serverQuestComplete, serverState, serverTurn } = await import('../world-server');
    const scopes: string[] = [];
    const agent = { com: { atproto: { server: { getServiceAuth: async ({ lxm }: { lxm: string }) => {
      scopes.push(lxm); return { data: { token: fakeJwt(Date.now() / 1000 + 300) } };
    } } } } } as unknown as Agent;
    const activeQuests = [{ id: 'a', progress: 3 }, { id: 'b', progress: 0 }];
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
      const snapshot = { activeQuests, questsDone: ['done'], power: 10, materials: {} };
      return Response.json(url.endsWith('/me/state') ? { state: snapshot, initialized: false } : snapshot);
    }) as typeof fetch;
    expect((await serverState(agent)).state.activeQuests).toEqual(activeQuests);
    expect((await serverQuestAccept(agent, 'b')).activeQuests).toEqual(activeQuests);
    expect((await serverQuestComplete(agent, 'b')).activeQuests).toEqual(activeQuests);
    expect(requests.slice(1).map(r => r.body)).toEqual([{ questId: 'b' }, { questId: 'b' }]);
    expect(scopes).toContain('app.aozoraquest.quest.accept');
    expect(scopes).toContain('app.aozoraquest.quest.complete');
    globalThis.fetch = (async () => Response.json({ state: {}, events: [], outcome: 'win', activeQuests: [], questsDone: ['a', 'b'] })) as typeof fetch;
    expect((await serverTurn(agent, 'battle', 0, 'attack')).activeQuests).toEqual([]);
  });

  it('エラー応答は WorldServerError (status 付き)', async () => {
    const { serverMove, WorldServerError } = await import('../world-server');
    const { agent } = mockAgent(Date.now() / 1000 + 300);
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'server_write_unavailable', reason: 'auth' }), { status: 503 })) as unknown as typeof fetch;
    const err = await serverMove(agent, 1, 0).catch((e) => e);
    expect(err).toBeInstanceOf(WorldServerError);
    expect(err.status).toBe(503);
  });

  it('service auth トークンは lxm ごとにキャッシュ (2回呼んでも getServiceAuth 1回)', async () => {
    const { serverMove } = await import('../world-server');
    const { agent, calls } = mockAgent(Date.now() / 1000 + 300);
    globalThis.fetch = (async () => new Response(JSON.stringify({ x: 0, y: 0, terrain: 'plains' }), { status: 200 })) as unknown as typeof fetch;
    await serverMove(agent, 1, 0);
    await serverMove(agent, 0, 1);
    expect(calls()).toBe(1); // 同一 lxm はキャッシュ再利用
  });

  it('タイムアウト/通信断は WorldServerError(status 0, code timeout/network) で throw (fail-closed)', async () => {
    const { serverMove, WorldServerError } = await import('../world-server');
    const { agent } = mockAgent(Date.now() / 1000 + 300);
    globalThis.fetch = (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as unknown as typeof fetch;
    const err = await serverMove(agent, 1, 0).catch((e) => e);
    expect(err).toBeInstanceOf(WorldServerError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('timeout');
  });

  it('401 応答は該当 lxm のトークンキャッシュを捨てて次回再取得する (401 ループ回避)', async () => {
    const { serverMove } = await import('../world-server');
    const { agent, calls } = mockAgent(Date.now() / 1000 + 300);
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })) as unknown as typeof fetch;
    await serverMove(agent, 1, 0).catch(() => {});
    await serverMove(agent, 0, 1).catch(() => {});
    expect(calls()).toBe(2); // 401 で evict → 2 回目も getServiceAuth し直す (キャッシュなら 1)
  });

  it('worldServerEnabled は env 有無で決まる', async () => {
    const mod = await import('../world-server');
    expect(mod.worldServerEnabled).toBe(true);
  });
});
