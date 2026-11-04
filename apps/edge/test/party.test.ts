/**
 * パーティ (D-PARTY-001 P2) の edge 権威。
 * - POST /api/party: ギルドの受付のそばだけ・入れられる人数・紹介できる人だけ。外した仲間の持ちこしは消える
 * - sealEncounter: 仲間がいると敵 1 体でも allies が組まれ、handleTurn は multi で解く
 * - 仲間の HP/MP は決着で持ちこし、宿屋・街・そらのはねで消える
 * - ボスの HP は ×(1 + 0.5 × 仲間の数)。台本負けは 1 人のまま
 * - targetIndex は handleTurn まで届き、2 体目に当たる
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { BASE_PALETTE, setInteriors, setMonsterOverrides, setNpcs, setStory, storyBattleById, townAt, worldOverlay, wrap, type InteriorMap, type MonsterDef, type NpcDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleMove, handleTeleport, handleTurn, sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { handlePartySet } from '../src/party-route';
import { handleInnRest } from '../src/inn-rest';
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
const LETTER = 'futaba_letter_done';
const GS = (over: Partial<GameState> = {}): GameState => ({ did: USER, activeQuests: [], power: 9, playerXp: 100, jobXp: { warrior: 400 }, materials: {}, gear: [], x: 10, y: 10, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over });

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
  return { fn, gs: () => store.get('gs')!.value as GameState, guard: () => store.get('guard')?.value as { state: { allies?: unknown[]; enemies?: Array<{ hp: number; maxHp: number }>; monster: { maxHp: number } } } | undefined };
}

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
const MONS = [mon('a'), mon('b'), mon('c'),
  mon('boss', { storyOnly: true, tier: 2, hp: 40, stats: [1, 1, 1, 1, 1] }),
  mon('wall', { storyOnly: true, tier: 2, hp: 400, stats: [1, 999, 1, 1, 1] }),
  mon('xr', { storyOnly: true, tier: 3, level: 99, hp: 9999, stats: [999, 999, 999, 1, 1] })];

const F = BASE_PALETTE.indexOf('plains');
const guildRoom = (): InteriorMap => ({ id: 'g-town', name: 'まち', size: 8, tiles: new Uint8Array(64).fill(F) });
const RECEPTION: NpcDef = { id: 'g-bluesky', name: 'うけつけ', mapId: 'g-town', x: 4, y: 4, lines: ['ようこそ'], guildReception: true };
const near = (env: ResolverEnv) => signPosition(env, { did: USER, mapId: 'g-town', x: 4, y: 5, counter: 1, iat: NOW });
const far = (env: ResolverEnv) => signPosition(env, { did: USER, mapId: 'g-town', x: 1, y: 1, counter: 1, iat: NOW });

async function fight(env: ResolverEnv, battleId: string, command: 'attack' | 'guard', targetIndex = 0) {
  for (let turn = 0; turn < 300; turn++) {
    const r = await handleTurn(env, USER, battleId, turn, command, NOW, undefined, 0, targetIndex);
    if (r.outcome !== 'ongoing') return r;
  }
  throw new Error('決着しない');
}

describe('パーティ (D-PARTY-001)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setMonsterOverrides(MONS);
    setInteriors([guildRoom()], []);
    setNpcs([RECEPTION]);
    setStory({
      battles: [
        { id: 'b-boss', monsterId: 'boss', count: 1, winFlag: 'beat-boss' },
        { id: 'b-wall2', monsterId: 'wall', count: 2, winFlag: 'beat-wall' },
        { id: 'b-x', monsterId: 'xr', count: 1, winFlag: 'beat-x', loseFlag: 'lost-x', canFlee: false, scripted: true },
      ],
      recruits: [
        { id: 'r-1', name: 'カイト', archetype: 'warrior', guild: 'g-bluesky', line: 'よろしく。' },
        { id: 'r-2', name: 'ミオ', archetype: 'miko', guild: 'g-bluesky', line: 'よろしく。' },
        { id: 'r-3', name: 'ソラ', archetype: 'mage', guild: 'g-bluesky', line: 'よろしく。' },
        { id: 'r-4', name: 'ハル', archetype: 'guardian', guild: 'g-bluesky', line: 'よろしく。' },
        { id: 'r-late', name: 'ユキ', archetype: 'sage', guild: 'g-bluesky', requireFlags: ['later'], line: 'よろしく。' },
      ],
    });
  });
  afterAll(() => { setStory(null); setNpcs(null); setInteriors(null, null); setMonsterOverrides(TEST_MONSTERS); });
  afterEach(() => { globalThis.fetch = orig; });

  describe('POST /api/party', () => {
    it('受付のそばなら入れられる。外した仲間の持ちこしは消える', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER], party: { ids: ['r-2'], hp: { 'r-2': 3 }, mp: { 'r-2': 1 } } }));
      globalThis.fetch = m.fn;
      const r = await handlePartySet(env, USER, 'g-bluesky', ['r-1'], near(env), NOW);
      expect(r.party).toEqual({ ids: ['r-1'] });
      expect(m.gs().party).toEqual({ ids: ['r-1'] });
    });

    it('受付のそばでなければ 403', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER] }));
      globalThis.fetch = m.fn;
      await expect(handlePartySet(env, USER, 'g-bluesky', ['r-1'], far(env), NOW)).rejects.toMatchObject({ status: 403 });
      expect(m.gs().party).toBeUndefined();
    });

    it('入れられる人数を超えると 400 (4 人を超える・章の人数を超える)', async () => {
      const env = await makeEnv();
      globalThis.fetch = pds(GS({ flags: [LETTER, 'yuuhi_feather_done', 'soyogi_feather_done'] })).fn;
      await expect(handlePartySet(env, USER, 'g-bluesky', ['r-1', 'r-2', 'r-3', 'r-4'], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'party_full' });
      globalThis.fetch = pds(GS({ flags: [LETTER] })).fn;
      await expect(handlePartySet(env, USER, 'g-bluesky', ['r-1', 'r-2'], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'party_full' });
      globalThis.fetch = pds(GS({ flags: [] })).fn;
      await expect(handlePartySet(env, USER, 'g-bluesky', ['r-1'], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'party_locked' });
    });

    it('紹介されていない冒険者 (条件のフラグが無い・知らない id) は新しく入れられない。入れている人は残せる', async () => {
      const env = await makeEnv();
      globalThis.fetch = pds(GS({ flags: [LETTER] })).fn;
      await expect(handlePartySet(env, USER, 'g-bluesky', ['r-late'], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'unknown_recruit' });
      await expect(handlePartySet(env, USER, 'g-bluesky', ['nope'], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'unknown_recruit' });
      const m = pds(GS({ flags: [LETTER, 'yuuhi_feather_done'], party: { ids: ['r-late'] } }));
      globalThis.fetch = m.fn;
      await handlePartySet(env, USER, 'g-bluesky', ['r-late', 'r-1'], near(env), NOW);
      expect(m.gs().party?.ids).toEqual(['r-late', 'r-1']);
    });
  });

  describe('戦闘', () => {
    it('仲間がいると敵 1 体でも multi で解く (allies に仲間が並ぶ)', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER], party: { ids: ['r-1'] } }));
      globalThis.fetch = m.fn;
      const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-boss'));
      expect(enc.state.allies).toHaveLength(2);
      expect(enc.state.enemies).toHaveLength(1);
      const r = await handleTurn(env, USER, enc.battleId, 0, 'guard', NOW);
      expect(r.events.some((e) => e.text.startsWith('カイト'))).toBe(true);
    });

    it('倒れた仲間 (HP 0 の持ちこし) は出ない', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER], party: { ids: ['r-1'], hp: { 'r-1': 0 } } }));
      globalThis.fetch = m.fn;
      const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-boss'));
      expect(enc.state.allies ?? [enc.state.player]).toHaveLength(1);
    });

    it('ボスの HP は ×1.5 (仲間 1 人)。count 2 は全員。1 人なら今のまま', async () => {
      const env = await makeEnv();
      const solo = pds(GS());
      globalThis.fetch = solo.fn;
      const one = await sealEncounter(env, USER, solo.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-boss'));
      const duo = pds(GS({ flags: [LETTER], party: { ids: ['r-1'] } }));
      globalThis.fetch = duo.fn;
      const two = await sealEncounter(env, USER, duo.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-boss'));
      expect(two.state.monster.maxHp).toBe(Math.round(one.state.monster.maxHp * 1.5));
      expect(two.state.monster.hp).toBe(two.state.monster.maxHp);
      expect(duo.guard()!.state.monster.maxHp).toBe(two.state.monster.maxHp);
      const pack = await sealEncounter(env, USER, duo.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-wall2'));
      const soloPack = await (async () => { globalThis.fetch = pds(GS()).fn; return sealEncounter(env, USER, GS(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-wall2')); })();
      expect(pack.state.enemies!.map((e) => e.maxHp)).toEqual(soloPack.state.enemies!.map((e) => Math.round(e.maxHp * 1.5)));
    });

    it('台本負け (scripted) では allies は主人公だけ', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER], party: { ids: ['r-1'] } }));
      globalThis.fetch = m.fn;
      const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-x'));
      expect(enc.state.allies ?? [enc.state.player]).toHaveLength(1);
    });

    it('targetIndex=1 で 2 体目に当たる', async () => {
      const env = await makeEnv();
      const m = pds(GS());
      globalThis.fetch = m.fn;
      const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-wall2'));
      const before = enc.state.enemies!.map((e) => e.hp);
      const r = await handleTurn(env, USER, enc.battleId, 0, 'attack', NOW, undefined, 0, 1);
      const after = r.state.enemies!.map((e) => e.hp);
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBeLessThan(before[1]!);
    });

    it('決着で仲間の HP/MP を持ちこす (満タンの仲間は書かない)', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER], party: { ids: ['r-1'] } }));
      globalThis.fetch = m.fn;
      const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-boss'));
      const r = await fight(env, enc.battleId, 'attack');
      expect(r.outcome).toBe('win');
      const ally = r.state.allies![1]!;
      const p = m.gs().party!;
      expect(p.ids).toEqual(['r-1']);
      expect(p.hp?.['r-1']).toBe(ally.hp < ally.maxHp ? ally.hp : undefined);
      expect(r.party).toEqual(p);
    });
  });

  describe('回復', () => {
    const hurt = { ids: ['r-1'], hp: { 'r-1': 2 }, mp: { 'r-1': 0 } };

    it('宿屋で party.hp/mp が消える', async () => {
      const env = await makeEnv();
      setInteriors([{ ...guildRoom(), inn: { x: 5, y: 5, price: 3 } }], []);
      const m = pds(GS({ mapId: 'g-town', x: 5, y: 5, party: hurt }));
      globalThis.fetch = m.fn;
      const r = await handleInnRest(env, USER, undefined, NOW);
      expect(r.inn?.paid).toBe(3);
      expect(m.gs().party).toEqual({ ids: ['r-1'] });
      setInteriors([guildRoom()], []);
    });

    it('街に入る・そらのはねで party.hp/mp が消える', async () => {
      const env = await makeEnv();
      const spawn = worldOverlay().spawn;
      const tok = signPosition(env, { did: USER, x: spawn.x, y: wrap(spawn.y + 1), counter: 1, iat: NOW });
      const m = pds(GS({ x: spawn.x, y: wrap(spawn.y + 1), party: hurt }));
      globalThis.fetch = m.fn;
      expect(townAt(spawn.x, spawn.y)).toBeTruthy();
      const r = await handleMove(env, USER, 0, -1, tok, NOW);
      expect(r.healed).toBe(true);
      expect(m.gs().party).toEqual({ ids: ['r-1'] });
      const m2 = pds(GS({ materials: { 'sky-feather': 1 }, party: hurt }));
      globalThis.fetch = m2.fn;
      await handleTeleport(env, USER, spawn.x, spawn.y, NOW);
      expect(m2.gs().party).toEqual({ ids: ['r-1'] });
    });
  });
});
