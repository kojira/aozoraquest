/**
 * ストーリー戦 (D-STORY-009 PR2) の edge 権威。
 * - handleTurn: パワー 0 でも勝てば winFlag。lose は loseFlag だけ。逃げはフラグなし。canFlee:false は flee を拒否
 * - handleMove: 固定モンスターのマスはランダム遭遇より先に戦闘。winFlag の後・requireFlags 不足では出ない
 * - /api/story/battle と受注の戦闘: 位置 (mapId 違い・斜め・離れた所) と条件のセリフで拒否。受注は新規のときだけ
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { isWalkable, setGameQuests, setMonsterOverrides, setNpcs, setStory, terrainAt, type MonsterDef } from '@aozoraquest/core';
import { handleMove, handleTurn, sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { handleQuestAcceptWithBattle, handleStoryBattle } from '../src/story-battle';
import { writeServerTokens } from '../src/oauth-store';
import { signPosition } from '../src/world-token';
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
const MONS = [mon('a'), mon('b'), mon('c'),
  mon('weak', { storyOnly: true, hp: 1, stats: [1, 1, 1, 1, 1] }),
  mon('strong', { storyOnly: true, tier: 3, level: 99, hp: 9999, stats: [999, 999, 1, 1, 1] }),
  mon('runner', { storyOnly: true, hp: 9999, stats: [1, 999, 999, 1, 1], ability: 'fleer' })];

/** walkable な (10,10) の隣を探す。 */
function step() {
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) if (isWalkable(terrainAt(10 + dx, 10 + dy))) return { dx, dy, x: 10 + dx, y: 10 + dy };
  throw new Error('no walkable step');
}

async function fight(env: ResolverEnv, battleId: string, command: 'attack' | 'flee' | 'guard') {
  let last;
  for (let turn = 0; turn < 300; turn++) {
    last = await handleTurn(env, USER, battleId, turn, command, NOW);
    if (last.outcome !== 'ongoing') return last;
  }
  throw new Error('決着しない');
}

describe('ストーリー戦 (D-STORY-009)', () => {
  const orig = globalThis.fetch;
  const S = step();
  beforeAll(() => {
    setMonsterOverrides(MONS);
    setNpcs([{ id: 'guard', name: 'もんばん', x: 30, y: 30, lines: ['やあ'], altLines: [{ flags: ['got-key'], lines: ['とおさん!'], battle: 'b-weak' }] }]);
    setGameQuests([{ id: 'q-duel', title: 'けっとう', npcId: 'guard', intro: ['いざ'], done: ['みごと'], objective: { kind: 'defeat', monsterId: 'a', count: 1 }, startBattle: 'b-strong' }]);
    setStory({
      battles: [
        { id: 'b-weak', monsterId: 'weak', count: 2, winFlag: 'beat-weak', canFlee: false },
        { id: 'b-strong', monsterId: 'strong', count: 1, winFlag: 'beat-strong', loseFlag: 'lost-strong' },
        { id: 'b-run', monsterId: 'runner', count: 1, winFlag: 'beat-run' },
      ],
      fieldMonsters: [{ id: 'fm', mapId: 'world', x: S.x, y: S.y, battleId: 'b-weak', requireFlags: ['got-key'] }],
    });
  });
  afterAll(() => { setStory(null); setGameQuests(null); setNpcs(null); setMonsterOverrides(null); });
  afterEach(() => { globalThis.fetch = orig; });

  const sealed = async (env: ResolverEnv, id: string) => {
    const { storyBattleById } = await import('@aozoraquest/core');
    return sealEncounter(env, USER, GS(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById(id));
  };

  it('パワー 0 でも勝てば winFlag が立つ。canFlee:false は flee を 400 で拒否し、撃破タイルは記録しない', async () => {
    const env = await makeEnv();
    const m = pds(GS({ power: 0 }));
    globalThis.fetch = m.fn;
    const enc = await sealed(env, 'b-weak');
    expect(enc.rewarded).toBe(false);
    expect(enc.state.enemies).toHaveLength(2);
    await expect(handleTurn(env, USER, enc.battleId, 0, 'flee', NOW)).rejects.toMatchObject({ status: 400, code: 'cannot_flee' });
    const res = await fight(env, enc.battleId, 'attack');
    expect(res.outcome).toBe('win');
    expect(m.gs().flags).toContain('beat-weak');
    expect(res.flags).toContain('beat-weak');
    expect(m.gs().defeated ?? []).toEqual([]);
  });

  it('lose は loseFlag だけ (winFlag なし)。逃げはフラグなし。ストーリー戦の敵は逃げない', async () => {
    const env = await makeEnv();
    const m = pds(GS());
    globalThis.fetch = m.fn;
    expect((await fight(env, (await sealed(env, 'b-strong')).battleId, 'attack')).outcome).toBe('lose');
    expect(m.gs().flags).toEqual(['lost-strong']);
    const m2 = pds(GS());
    globalThis.fetch = m2.fn;
    // fleer の敵でも monster-fled にならない。数ターン様子を見てから こちらが逃げる
    const run = await sealed(env, 'b-run');
    let outcome = 'ongoing';
    for (let turn = 0; outcome === 'ongoing'; turn++) outcome = (await handleTurn(env, USER, run.battleId, turn, turn < 5 ? 'guard' : 'flee', NOW)).outcome;
    expect(outcome).toBe('fled');
    expect(m2.gs().flags ?? []).toEqual([]);
  });

  it('handleMove: 固定モンスターのマスはランダム遭遇より先に戦闘。条件不足・勝利後は出ない', async () => {
    const env = await makeEnv();
    const from = signPosition(env, { did: USER, x: 10, y: 10, counter: 1, iat: NOW });
    globalThis.fetch = pds(GS({ flags: ['got-key'] })).fn;
    const hit = await handleMove(env, USER, S.dx, S.dy, from, NOW);
    expect(hit.encounter?.monsterId).toBe('weak');
    expect(hit.encounter?.state.story).toEqual({ canFlee: false });
    for (const flags of [[], ['got-key', 'beat-weak']]) {
      globalThis.fetch = pds(GS({ flags })).fn;
      const r = await handleMove(env, USER, S.dx, S.dy, from, NOW);
      expect(r.encounter).toBeUndefined(); // ランダム遭遇もない普通のマス
    }
  });

  it('/api/story/battle: mapId 違い・斜め・離れた位置・条件のセリフでないときは 400。隣なら始まる', async () => {
    const env = await makeEnv();
    const tok = (x: number, y: number, mapId?: string) => signPosition(env, { did: USER, ...(mapId ? { mapId } : {}), x, y, counter: 1, iat: NOW });
    globalThis.fetch = pds(GS({ flags: ['got-key'] })).fn;
    for (const t of [tok(31, 30, 'room'), tok(31, 31), tok(33, 30)]) {
      await expect(handleStoryBattle(env, USER, 'guard', t, NOW)).rejects.toMatchObject({ status: 400 });
    }
    expect((await handleStoryBattle(env, USER, 'guard', tok(31, 30), NOW)).monsterId).toBe('weak');
    for (const flags of [[], ['got-key', 'beat-weak']]) {
      globalThis.fetch = pds(GS({ flags })).fn;
      await expect(handleStoryBattle(env, USER, 'guard', tok(31, 30), NOW)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('受注で始まる戦闘: 依頼主の隣で新しく受けたときだけ。再送・離れた位置では始まらない', async () => {
    const env = await makeEnv();
    const near = signPosition(env, { did: USER, x: 30, y: 29, counter: 1, iat: NOW });
    const m = pds(GS());
    globalThis.fetch = m.fn;
    await expect(handleQuestAcceptWithBattle(env, USER, 'q-duel', signPosition(env, { did: USER, x: 29, y: 29, counter: 1, iat: NOW }), NOW)).rejects.toMatchObject({ status: 400 });
    expect(m.gs().activeQuests).toEqual([]);
    const first = await handleQuestAcceptWithBattle(env, USER, 'q-duel', near, NOW);
    expect(first.encounter?.monsterId).toBe('strong');
    expect(first.activeQuests).toEqual([{ id: 'q-duel', progress: 0 }]);
    expect((await handleQuestAcceptWithBattle(env, USER, 'q-duel', near, NOW)).encounter).toBeUndefined();
  });
});
