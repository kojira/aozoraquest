import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { sealEncounter, handleMove, handleTurn, ResolverError, GUARD_TTL_SEC, type ResolverEnv } from '../src/battle-resolver';
import { writeServerTokens } from '../src/oauth-store';
import { terrainAt, isWalkable, type Command } from '@aozoraquest/core';
import type { GameState } from '../src/game-state';

const USER = 'did:plc:alice';
const SERVER_DID = 'did:plc:kojira';
const SERVER_PDS = 'https://server-pds.example';
const USER_PDS = 'https://user-pds.example';
const NOW = 1_700_000_000;

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
function mockKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
}
async function makeEnv(): Promise<ResolverEnv> {
  const kv = mockKv();
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: SERVER_PDS, authServer: 'https://bsky.social', updatedAt: NOW });
  return { OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID, WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}

const DIAG = { archetype: 'warrior', rpgStats: { atk: 30, def: 25, agi: 15, int: 15, luk: 15 } };
const GS = (over: Partial<GameState> = {}): GameState => ({ did: USER, power: 5, playerXp: 100, jobXp: { warrior: 50 }, materials: {}, gear: [], x: 0, y: 0, version: 1, updatedAt: '', ...over });

/** 診断 + サーバー PDS (gameState + guard) の CAS を実装する統合モック。 */
function resolverMock(opts: { diagnosis?: unknown; gameState?: GameState } = {}) {
  const store = new Map<string, { value: unknown; cid: string }>();
  if (opts.gameState) store.set('gs', { value: opts.gameState, cid: 'gs0' });
  const guardKey = 'guard';
  let counter = 0;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const which = (col: string) => (col === 'app.aozoraquest.gameState' ? 'gs' : col === 'app.aozoraquest.battleGuard' ? guardKey : col);
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('plc.directory')) return json(200, { id: USER, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: USER_PDS }] });
    if (url.includes('getRecord')) {
      const u = new URL(url);
      const col = u.searchParams.get('collection')!;
      if (col === 'app.aozoraquest.analysis') return opts.diagnosis ? json(200, { uri: 'x', cid: 'd', value: opts.diagnosis }) : json(400, { error: 'RecordNotFound' });
      const rec = store.get(which(col));
      return rec ? json(200, { uri: 'x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    const b = JSON.parse(init.body as string) as { collection: string; record?: unknown; swapRecord?: string | null };
    const k = which(b.collection);
    const cur = store.get(k);
    if (url.includes('putRecord')) {
      if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      const cid = `c${++counter}`;
      store.set(k, { value: b.record, cid });
      return json(200, { uri: 'x', cid });
    }
    if (url.includes('deleteRecord')) {
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      store.delete(k);
      return json(200, {});
    }
    return json(404, { error: 'nf' });
  }) as unknown as typeof fetch;
  return { fn, store };
}

describe('battle-resolver (サーバー権威 移動/戦闘)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('sealEncounter: monster を返すが **seed は返さない** + rewarded は power で決まる', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    const r = await sealEncounter(env, USER, GS({ power: 5 }), 5, 5, NOW);
    expect(r.battleId).toMatch(/^b[0-9a-f]{24}$/);
    expect(r.monsterId).toBeTruthy();
    expect(r.rewarded).toBe(true);
    expect('seed' in r.state).toBe(false); // ★ 内部 seed 非漏洩
    expect(await sealEncounter(env, USER, GS(), 5, 5, NOW).catch((e) => e)).toBeInstanceOf(Error); // 二重戦闘 (guard 既存)
  });

  it('sealEncounter: power 0 → rewarded=false / 診断なし → 409', async () => {
    let env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ power: 0 }) }).fn;
    expect((await sealEncounter(env, USER, GS({ power: 0 }), 5, 5, NOW)).rewarded).toBe(false);
    env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: undefined, gameState: GS() }).fn;
    await expect(sealEncounter(env, USER, GS(), 5, 5, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it('move: 隣接1マスだけ許可 (斜め2マス/同地は 400) + 権威位置を更新', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ x: 10, y: 10 }) }).fn;
    await expect(handleMove(env, USER, 0, 0, NOW)).rejects.toMatchObject({ status: 400 });
    await expect(handleMove(env, USER, 2, 0, NOW)).rejects.toMatchObject({ status: 400 });
    // 歩ける隣接方向を探して 1 マス動く
    let moved = false;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]] as const) {
      if (isWalkable(terrainAt(10 + dx, 10 + dy))) {
        const r = await handleMove(env, USER, dx, dy, NOW);
        expect(r.x).toBe(10 + dx);
        expect(r.y).toBe(10 + dy);
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });

  it('move: 戦闘中 (期限内ガード) は 409 / 期限切れガードは flush して移動できる', async () => {
    const env = await makeEnv();
    const m = resolverMock({ diagnosis: DIAG, gameState: GS({ x: 10, y: 10 }) });
    globalThis.fetch = m.fn;
    await sealEncounter(env, USER, GS({ x: 10, y: 10 }), 10, 10, NOW); // guard 作成 (expiresAt=NOW+TTL)
    // 期限内: 移動不可
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0]] as const) {
      if (isWalkable(terrainAt(10 + dx, 10 + dy))) { await expect(handleMove(env, USER, dx, dy, NOW)).rejects.toMatchObject({ status: 409 }); break; }
    }
    // 期限切れ (now > expiresAt): flush して移動できる
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0]] as const) {
      if (isWalkable(terrainAt(10 + dx, 10 + dy))) { const r = await handleMove(env, USER, dx, dy, NOW + GUARD_TTL_SEC + 10); expect(r.x).toBe(10 + dx); break; }
    }
    expect(m.store.has('guard')).toBe(false); // flush 済み
  });

  it('turn: battleId/turn 不一致は 409 / 不正コマンド 400 / 戦闘中でなければ 409', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    await expect(handleTurn(env, USER, 'x', 0, 'attack', NOW)).rejects.toMatchObject({ status: 409 }); // guard なし
    const enc = await sealEncounter(env, USER, GS(), 5, 5, NOW);
    await expect(handleTurn(env, USER, 'wrong', 0, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
    await expect(handleTurn(env, USER, enc.battleId, 5, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
    await expect(handleTurn(env, USER, enc.battleId, 0, 'hack' as Command, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('決着まで戦うと **報酬が権威 state に確定**しガードが消える (二重報酬なし)', async () => {
    const env = await makeEnv();
    const m = resolverMock({ diagnosis: DIAG, gameState: GS({ power: 5, playerXp: 100, materials: { ore: 5 } }) });
    globalThis.fetch = m.fn;
    const enc = await sealEncounter(env, USER, GS({ power: 5, playerXp: 100, materials: { ore: 5 } }), 5, 5, NOW);
    let outcome = 'ongoing';
    let last;
    for (let turn = 0; turn < 40 && outcome === 'ongoing'; turn++) {
      last = await handleTurn(env, USER, enc.battleId, turn, 'attack', NOW);
      outcome = last.outcome;
    }
    expect(['win', 'lose', 'draw']).toContain(outcome); // 30 ターンで必ず決着
    expect(m.store.has('guard')).toBe(false); // ガードは決着で消える
    const gs = m.store.get('gs')!.value as GameState;
    if (outcome === 'win') {
      expect(gs.playerXp).toBeGreaterThan(100); // XP が権威 state に加算された
      expect(gs.power).toBe(4); // パワー 1 消費
      expect(last!.awarded?.xp).toBeGreaterThan(0);
    }
    // 決着後に同じターンを再送 → guard 無し = 409 (二重報酬不可)
    await expect(handleTurn(env, USER, enc.battleId, 0, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
  });
});
