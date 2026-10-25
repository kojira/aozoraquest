/**
 * 台本負けのストーリー戦 (scripted) の edge 権威。
 * - 負けても素材・パワーは減らず、街へ戻らずその場に残る。HP/MP は 1 で残る
 * - loseFlag が立ち、それに続くシナリオのお知らせが返る
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { setMonsterOverrides, setScenario, setStory, storyBattleById, type MonsterDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleTurn, sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { writeServerTokens } from '../src/oauth-store';
import { XP_EPOCH, type GameState } from '../src/game-state';

const USER = 'did:plc:alice';
const NOW = 1_700_000_000;
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
const GS = (over: Partial<GameState> = {}): GameState => ({ did: USER, activeQuests: [], power: 0, playerXp: 100, jobXp: { warrior: 50 }, materials: {}, gear: [], x: 10, y: 10, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over });

/** 診断 + gameState + guard を CAS 付きで持つ PDS。 */
function pds(seed: GameState) {
  const store = new Map<string, { value: unknown; cid: string }>([['gs', { value: seed, cid: 'gs0' }]]);
  let n = 0;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const key = (col: string) => (col.endsWith('.gameState') ? 'gs' : col.endsWith('.battleGuard') ? 'guard' : col);
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('plc.directory')) return json(200, { id: USER, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://user-pds.example' }] });
    if (url.includes('getRecord')) {
      const col = new URL(url).searchParams.get('collection')!;
      if (col.endsWith('.analysis')) return json(200, { uri: 'x', cid: 'd', value: { archetype: 'warrior', rpgStats: { atk: 30, def: 25, agi: 15, int: 15, luk: 15 } } });
      const rec = store.get(key(col));
      return rec ? json(200, { uri: 'x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    const b = JSON.parse(init.body as string) as { collection: string; record?: unknown; swapRecord?: string | null };
    const k = key(b.collection), cur = store.get(k);
    if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
    if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
    if (url.includes('deleteRecord')) { store.delete(k); return json(200, {}); }
    store.set(k, { value: b.record, cid: `c${++n}` });
    return json(200, { uri: 'x', cid: `c${n}` });
  }) as unknown as typeof fetch;
  return { fn, gs: () => store.get('gs')!.value as GameState, hasGuard: () => store.has('guard') };
}

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });

describe('台本負けのストーリー戦 (scripted)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setMonsterOverrides([mon('a'), mon('b'), mon('c'), mon('xr', { storyOnly: true, tier: 3, level: 99, hp: 9999, stats: [999, 999, 999, 1, 1] })]);
    setStory({ battles: [{ id: 'b-x', monsterId: 'xr', count: 1, winFlag: 'beat-x', loseFlag: 'lost-x', canFlee: false, scripted: true }] });
    setScenario([{ id: 'spared', title: 't', when: [{ kind: 'flag', flag: 'lost-x' }], setFlags: ['x-spared'], notice: 'とどめは来なかった。' }]);
  });
  afterAll(() => { setScenario(null); setStory(null); setMonsterOverrides(TEST_MONSTERS); });
  afterEach(() => { globalThis.fetch = orig; });

  it('負けても素材・パワーは減らず、その場 (内部マップ) に残る。HP/MP は 1。loseFlag とお知らせが返る', async () => {
    const env = await makeEnv();
    const before = GS({ power: 50, materials: { 'slime-drop': 5, 'bat-wing': 3 }, mapId: 'nest', x: 4, y: 5, lastTown: { x: 320, y: 448 } });
    const m = pds(before);
    globalThis.fetch = m.fn;
    const enc = await sealEncounter(env, USER, before, 4, 5, 1, NOW, undefined, undefined, 'nest', storyBattleById('b-x'));
    expect(enc.state.story).toEqual({ canFlee: false, scripted: true });
    const res = await handleTurn(env, USER, enc.battleId, 0, 'attack', NOW);
    expect(res.outcome).toBe('lose');
    expect(res.awarded).toEqual({});
    expect(res.position).toEqual({ x: 4, y: 5 });
    expect(res.scenarioNotices).toEqual(['とどめは来なかった。']);
    const gs = m.gs();
    expect(gs.power).toBe(50);
    expect(gs.materials).toEqual({ 'slime-drop': 5, 'bat-wing': 3 });
    expect({ mapId: gs.mapId, x: gs.x, y: gs.y }).toEqual({ mapId: 'nest', x: 4, y: 5 });
    expect({ hp: gs.carryHp, mp: gs.carryMp }).toEqual({ hp: 1, mp: 1 });
    expect(gs.flags).toEqual(['lost-x', 'x-spared']);
    expect(m.hasGuard()).toBe(false);
  });
});
