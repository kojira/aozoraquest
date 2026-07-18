import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { handleEncounter, handleTurn, ResolverError, type ResolverEnv } from '../src/battle-resolver';
import { writeServerTokens } from '../src/oauth-store';

const USER = 'did:plc:alice';
const SERVER_DID = 'did:plc:kojira';
const SERVER_PDS = 'https://server-pds.example';
const USER_PDS = 'https://user-pds.example';
const NOW = 1_700_000_000;
// 陸地・非 town の座標を探す (terrainAt に依存)。0,0 が town/water の可能性があるので数点試す。
import { terrainAt, isWalkable } from '@aozoraquest/core';
function landCoord(): { x: number; y: number } {
  for (let x = 0; x < 200; x += 7) for (let y = 0; y < 200; y += 7) {
    const t = terrainAt(x, y);
    if (isWalkable(t) && t !== 'town') return { x, y };
  }
  throw new Error('no land coord');
}
const { x: LX, y: LY } = landCoord();

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

/** 診断・GameState を種にした統合モック (ユーザー DID 解決 + 診断 + サーバー PDS CAS)。 */
function resolverMock(opts: { diagnosis?: unknown; gameState?: unknown } = {}) {
  const store = new Map<string, { value: unknown; cid: string }>();
  if (opts.gameState) store.set('app.aozoraquest.gameState/' + 'u', { value: opts.gameState, cid: 'gs0' }); // rkey は下で正規化
  let counter = 0;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const key = (col: string, rk: string) => `${col}/${rk}`;
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('plc.directory')) return json(200, { id: USER, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: USER_PDS }] });
    if (url.includes('getRecord')) {
      const u = new URL(url);
      const col = u.searchParams.get('collection')!;
      const rk = u.searchParams.get('rkey')!;
      if (col === 'app.aozoraquest.analysis') return opts.diagnosis ? json(200, { uri: 'x', cid: 'd', value: opts.diagnosis }) : json(400, { error: 'RecordNotFound' });
      // gameState は rkey が sha256(DID) 依存なので col だけで拾う
      const hit = [...store.entries()].find(([k]) => k.startsWith(col + '/'));
      return hit ? json(200, { uri: 'x', cid: hit[1].cid, value: hit[1].value }) : json(400, { error: 'RecordNotFound' });
    }
    const b = JSON.parse(init.body as string) as { collection: string; rkey: string; record?: unknown; swapRecord?: string | null };
    const k = key(b.collection, b.rkey);
    const cur = store.get(k) ?? [...store.entries()].find(([kk]) => kk.startsWith(b.collection + '/'))?.[1];
    if (url.includes('putRecord')) {
      if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      // 既存を消して新規で置く (rkey 正規化のズレを吸収)
      for (const kk of [...store.keys()]) if (kk.startsWith(b.collection + '/')) store.delete(kk);
      const cid = `c${++counter}`;
      store.set(k, { value: b.record, cid });
      return json(200, { uri: 'x', cid });
    }
    if (url.includes('deleteRecord')) {
      for (const kk of [...store.keys()]) if (kk.startsWith(b.collection + '/')) store.delete(kk);
      return json(200, {});
    }
    return json(404, { error: 'nf' });
  }) as unknown as typeof fetch;
  return { fn, store };
}

const DIAG = { archetype: 'warrior', rpgStats: { atk: 30, def: 25, agi: 15, int: 15, luk: 15 } };
const GS = (over: Record<string, unknown> = {}) => ({ did: USER, power: 5, playerXp: 100, jobXp: { warrior: 50 }, materials: {}, gear: [], x: 0, y: 0, version: 1, updatedAt: '', ...over });

describe('battle-resolver (サーバー権威 戦闘)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('encounter: monster を返すが **seed は返さない** (先読み防止) + rewarded は power で決まる', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ power: 5 }) }).fn;
    const r = await handleEncounter(env, USER, LX, LY, NOW);
    expect(r.battleId).toMatch(/^b[0-9a-f]{24}$/);
    expect(r.monsterId).toBeTruthy();
    expect(r.rewarded).toBe(true); // power 5 >= 1
    expect('seed' in r.state).toBe(false); // ★ 内部 seed は client に返らない
    expect(r.state.monster).toBeTruthy();
    expect(r.state.player.hp).toBeGreaterThan(0);
  });

  it('encounter: power 0 なら rewarded=false (パワー無し=練習)', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ power: 0 }) }).fn;
    const r = await handleEncounter(env, USER, LX, LY, NOW);
    expect(r.rewarded).toBe(false);
  });

  it('encounter: 診断が無ければ 409 (snapshot を封印できない)', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: undefined, gameState: GS() }).fn;
    await expect(handleEncounter(env, USER, LX, LY, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it('encounter: town/水域では遭遇しない (400)', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    // town を探す
    let tx = -1, ty = -1;
    for (let x = 0; x < 300 && tx < 0; x += 3) for (let y = 0; y < 300; y += 3) { if (terrainAt(x, y) === 'town') { tx = x; ty = y; break; } }
    if (tx >= 0) await expect(handleEncounter(env, USER, tx, ty, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('二重戦闘不可: encounter 中に再 encounter は 409', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    await handleEncounter(env, USER, LX, LY, NOW);
    await expect(handleEncounter(env, USER, LX, LY, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it('turn: battleId/turn 不一致は 409 (やり直し/リプレイ封じ)', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    const enc = await handleEncounter(env, USER, LX, LY, NOW);
    await expect(handleTurn(env, USER, 'wrong-id', 0, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
    await expect(handleTurn(env, USER, enc.battleId, 5, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
  });

  it('turn: 戦闘中でなければ 409', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    await expect(handleTurn(env, USER, 'x', 0, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
  });

  it('turn: 1 コマンドを解決し seed 無し state を返す (未決着なら outcome=ongoing)', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    const enc = await handleEncounter(env, USER, LX, LY, NOW);
    const t = await handleTurn(env, USER, enc.battleId, 0, 'guard', NOW);
    expect('seed' in t.state).toBe(false);
    expect(['ongoing', 'win', 'lose', 'draw', 'fled']).toContain(t.outcome);
    expect(Array.isArray(t.events)).toBe(true);
  });

  it('不正コマンドは 400', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    const enc = await handleEncounter(env, USER, LX, LY, NOW);
    await expect(handleTurn(env, USER, enc.battleId, 0, 'hack' as never, NOW)).rejects.toMatchObject({ status: 400 });
  });
});
