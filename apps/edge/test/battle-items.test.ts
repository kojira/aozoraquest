/**
 * 戦闘のどうぐ (D-ITEM-001 I2) の edge 権威。
 * - 封印 (sealEncounter) に手持ちの戦闘用どうぐが写る
 * - 持っていない itemId は 400 no_item でターンを進めない
 * - 決着で使った数だけ materials から減る (負けても減る)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { activeEquipment, activeItems, setItemOverrides, type ItemDefData } from '@aozoraquest/core';
import { handleTurn, sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { writeServerTokens } from '../src/oauth-store';
import { XP_EPOCH, type GameState } from '../src/game-state';
import type { BattleGuard } from '../src/battle-guard';

const USER = 'did:plc:alice';
const NOW = 1_700_000_000;
const NEMURI: ItemDefData = {
  id: 'nemuri-kona', name: 'ねむりごな',
  battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', chance: 1, turns: 3 }] },
};

function jwk(fill: number) {
  const d = new Uint8Array(32).fill(fill), pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
async function makeEnv(): Promise<ResolverEnv> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: 'did:plc:server', accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: 'https://server-pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { OAUTH_CLIENT_PRIVATE_JWK: jwk(3), OAUTH_DPOP_PRIVATE_JWK: jwk(5), SERVER_DID: 'did:plc:server', WORKER_DID: 'did:web:edge.example', OAUTH_TOKENS: kv };
}
const GS = (over: Partial<GameState> = {}): GameState => ({ did: USER, activeQuests: [], power: 5, playerXp: 100, jobXp: { warrior: 50 }, materials: {}, gear: [], x: 5, y: 5, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over });
const DIAG = { archetype: 'warrior', rpgStats: { atk: 30, def: 25, agi: 15, int: 15, luk: 15 } };

/** 診断 + サーバー PDS (gameState + guard) の CAS を実装するモック。 */
function pdsMock(gameState: GameState) {
  const store = new Map<string, { value: unknown; cid: string }>([['gs', { value: gameState, cid: 'gs0' }]]);
  let counter = 0;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const which = (col: string) => (col === 'app.aozoraquest.gameState' ? 'gs' : col === 'app.aozoraquest.battleGuard' ? 'guard' : col);
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('plc.directory')) return json(200, { id: USER, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://user-pds.example' }] });
    if (url.includes('getRecord')) {
      const col = new URL(url).searchParams.get('collection')!;
      if (col === 'app.aozoraquest.analysis') return json(200, { uri: 'x', cid: 'd', value: DIAG });
      const rec = store.get(which(col));
      return rec ? json(200, { uri: 'x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    const b = JSON.parse(init.body as string) as { collection: string; record?: unknown; swapRecord?: string | null };
    const k = which(b.collection), cur = store.get(k);
    if (url.includes('putRecord')) {
      if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      store.set(k, { value: b.record, cid: `c${++counter}` });
      return json(200, { uri: 'x', cid: `c${counter}` });
    }
    if (url.includes('deleteRecord')) { store.delete(k); return json(200, {}); }
    return json(404, { error: 'nf' });
  }) as unknown as typeof fetch;
  return { fn, store };
}
const guardOf = (store: Map<string, { value: unknown }>) => store.get('guard')?.value as BattleGuard<unknown, { battleItems?: Record<string, number> }> | undefined;
const gsOf = (store: Map<string, { value: unknown }>) => store.get('gs')!.value as GameState;

describe('戦闘のどうぐ (edge, D-ITEM-001)', () => {
  const orig = globalThis.fetch;
  beforeEach(() => setItemOverrides({ items: [...activeItems(), NEMURI], equipment: [...activeEquipment()] }));
  afterEach(() => { globalThis.fetch = orig; setItemOverrides(null); });

  it('封印に手持ちの戦闘用どうぐが写る (種類ごと 2 個まで・素材は写らない)', async () => {
    const gs = GS({ materials: { 'nemuri-kona': 5, herb: 3, 'slime-drop': 2 } });
    const m = pdsMock(gs);
    globalThis.fetch = m.fn;
    const enc = await sealEncounter(await makeEnv(), USER, gs, 5, 5, 12345, NOW);
    expect(guardOf(m.store)!.state.battleItems).toEqual({ 'nemuri-kona': 2 });
    expect((enc.state as { battleItems?: unknown }).battleItems).toEqual({ 'nemuri-kona': 2 });
  });

  it('持っていない itemId は 400 no_item で、ターンは進まない', async () => {
    const gs = GS({ materials: {} });
    const m = pdsMock(gs);
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    const enc = await sealEncounter(env, USER, gs, 5, 5, 12345, NOW);
    await expect(handleTurn(env, USER, enc.battleId, 0, 'item', NOW, undefined, 0, 0, 'nemuri-kona')).rejects.toMatchObject({ status: 400, code: 'no_item' });
    expect(guardOf(m.store)!.turn).toBe(0);
    // ターンが進んでいないので、同じ turn=0 でふつうに戦える
    await expect(handleTurn(env, USER, enc.battleId, 0, 'attack', NOW)).resolves.toBeTruthy();
  });

  it('決着で使った数だけ減る (報酬ありでも なしでも)', async () => {
    for (const power of [5, 0]) {
      const gs = GS({ power, materials: { 'nemuri-kona': 3 } });
      const m = pdsMock(gs);
      globalThis.fetch = m.fn;
      const env = await makeEnv();
      const enc = await sealEncounter(env, USER, gs, 5, 5, 12345, NOW);
      let last = await handleTurn(env, USER, enc.battleId, 0, 'item', NOW, undefined, 0, 0, 'nemuri-kona');
      expect(last.state.lastEvents.map((e) => e.text)).toContain('(のこり 1)');
      for (let t = 1; t < 60 && last.outcome === 'ongoing'; t++) last = await handleTurn(env, USER, enc.battleId, t, 'attack', NOW);
      expect(last.outcome).not.toBe('ongoing');
      const lost = (last.awarded?.materialsLost ?? []).filter((x) => x === 'nemuri-kona').length;
      expect(gsOf(m.store).materials['nemuri-kona'] ?? 0).toBe(3 - 1 - lost);
    }
  });

  it('負けても使った数は減る', async () => {
    // HP が少ない状態で始め、どうぐを使ったあと ぼうぎょ だけで負ける
    const gs = GS({ materials: { 'nemuri-kona': 2 }, carryHp: 12 });
    const m = pdsMock(gs);
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    const enc = await sealEncounter(env, USER, gs, 5, 5, 12345, NOW);
    let last = await handleTurn(env, USER, enc.battleId, 0, 'item', NOW, undefined, 0, 0, 'nemuri-kona');
    expect(last.state.lastEvents.map((e) => e.text)).toContain('(のこり 1)');
    for (let t = 1; t < 60 && last.outcome === 'ongoing'; t++) last = await handleTurn(env, USER, enc.battleId, t, 'guard', NOW);
    expect(last.outcome).toBe('lose');
    const lost = (last.awarded?.materialsLost ?? []).filter((x) => x === 'nemuri-kona').length;
    expect(gsOf(m.store).materials['nemuri-kona'] ?? 0).toBe(2 - 1 - lost);
  });
});
