/**
 * パーティ (D-PARTY-001 P2) の edge 権威。
 * - POST /api/party: ギルドの受付のそばだけ・入れられる人数・紹介できる人だけ。外した仲間の持ちこしは消える
 * - sealEncounter: 仲間がいると敵 1 体でも allies が組まれ、handleTurn は multi で解く
 * - 仲間の HP/MP は決着で持ちこし、宿屋・街・そらのはねで消える
 * - ボスの HP は仲間の数で変えない (D-PARTY-002 §12)。台本負けは 1 人のまま
 * - targetIndex は handleTurn まで届き、2 体目に当たる
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setInteriors, setMonsterOverrides, setNpcs, setStory, storyBattleById, townAt, worldOverlay, wrap, type MonsterDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleMove, handleTeleport, handleTurn, sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { handlePartySet } from '../src/party-route';
import { handleInnRest } from '../src/inn-rest';
import { signPosition } from '../src/world-token';
import { GS, guildRoom, LETTER, makeEnv, near, far, NOW, pds, RECEPTION, USER } from './support/party-env';

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
const MONS = [mon('a'), mon('b'), mon('c'),
  mon('boss', { storyOnly: true, tier: 2, hp: 40, stats: [1, 1, 1, 1, 1] }),
  mon('wall', { storyOnly: true, tier: 2, hp: 400, stats: [1, 999, 1, 1, 1] }),
  mon('xr', { storyOnly: true, tier: 3, level: 99, hp: 9999, stats: [999, 999, 999, 1, 1] })];

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
        { id: 'r-high', name: 'ゲン', archetype: 'ninja', guild: 'g-bluesky', minLevel: 99, line: 'よろしく。' },
      ],
    });
  });
  afterAll(() => { setStory(null); setNpcs(null); setInteriors(null, null); setMonsterOverrides(TEST_MONSTERS); });
  afterEach(() => { globalThis.fetch = orig; });

  describe('POST /api/party', () => {
    // 候補は日替わりのガチャ (D-PARTY-002)。名前つきの冒険者 (なじみ) を入れる前提の確かめは、gacha.test.ts。
    // ここは「もう入れている人」の扱い (残せる・外すと持ちこしが消える・人数) を見る。
    it('外した仲間の持ちこしは消える', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER, 'yuuhi_feather_done'], party: { ids: ['r-2', 'r-1'], hp: { 'r-2': 3, 'r-1': 2 }, mp: { 'r-2': 1 } } }));
      globalThis.fetch = m.fn;
      const r = await handlePartySet(env, USER, 'g-bluesky', ['r-1'], near(env), NOW);
      expect(r.party).toMatchObject({ ids: ['r-1'], hp: { 'r-1': 2 } });
      expect(m.gs().party?.mp).toBeUndefined();
    });

    it('受付のそばでなければ 403', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER], party: { ids: ['r-1'] } }));
      globalThis.fetch = m.fn;
      await expect(handlePartySet(env, USER, 'g-bluesky', [], far(env), NOW)).rejects.toMatchObject({ status: 403 });
      expect(m.gs().party).toEqual({ ids: ['r-1'] });
    });

    it('入れられる人数を超えると 400 (章の人数を超える)。まだ組めなければ party_locked', async () => {
      const env = await makeEnv();
      globalThis.fetch = pds(GS({ flags: [LETTER], party: { ids: ['r-1', 'r-2'] } })).fn;
      await expect(handlePartySet(env, USER, 'g-bluesky', ['r-1', 'r-2'], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'party_full' });
      globalThis.fetch = pds(GS({ flags: [], party: { ids: ['r-1'] } })).fn;
      await expect(handlePartySet(env, USER, 'g-bluesky', ['r-1'], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'party_locked' });
    });

    it('もう入れている人は、紹介の条件や minLevel が合わなくても残せる', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER, 'yuuhi_feather_done'], party: { ids: ['r-late', 'r-high'] } }));
      globalThis.fetch = m.fn;
      await handlePartySet(env, USER, 'g-bluesky', ['r-late', 'r-high'], near(env), NOW);
      expect(m.gs().party?.ids).toEqual(['r-late', 'r-high']);
    });

    it('知らない id (admin のデータから消えた冒険者) が state に残っていても、外せて、その id は消える', async () => {
      const env = await makeEnv();
      const stale = { ids: ['gone', 'r-1'], hp: { gone: 3, 'r-1': 2 } };
      const m = pds(GS({ flags: [LETTER], party: stale }));
      globalThis.fetch = m.fn;
      const r = await handlePartySet(env, USER, 'g-bluesky', ['gone', 'r-1'], near(env), NOW);
      expect(r.party.ids).toEqual(['r-1']);
      expect(m.gs().party?.hp).toEqual({ 'r-1': 2 });
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

    it('ボスの HP は仲間がいても変わらない (章の想定人数で合わせる。D-PARTY-002 §12)。count 2 も同じ', async () => {
      const env = await makeEnv();
      const solo = pds(GS());
      globalThis.fetch = solo.fn;
      const one = await sealEncounter(env, USER, solo.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-boss'));
      const duo = pds(GS({ flags: [LETTER], party: { ids: ['r-1'] } }));
      globalThis.fetch = duo.fn;
      const two = await sealEncounter(env, USER, duo.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-boss'));
      expect(two.state.allies).toHaveLength(2);
      expect(two.state.monster.maxHp).toBe(one.state.monster.maxHp);
      expect(duo.guard()!.state.monster.maxHp).toBe(one.state.monster.maxHp);
      const pack = await sealEncounter(env, USER, duo.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-wall2'));
      const soloPack = await (async () => { globalThis.fetch = pds(GS()).fn; return sealEncounter(env, USER, GS(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-wall2')); })();
      expect(pack.state.enemies!.map((e) => e.maxHp)).toEqual(soloPack.state.enemies!.map((e) => e.maxHp));
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

describe('群れ (D-PARTY-001 P4)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; setStory(null); });
  /** フィールドで群れになる seed を探す (encounterGroupSize と同じ判定)。 */
  const groupSeed = async (x: number, y: number) => {
    const { encounterGroupSize, MONSTERS_BY_ID, startBattle, tierForRegion, regionOf } = await import('@aozoraquest/core');
    for (let seed = 1; seed < 5000; seed++) {
      const b = startBattle('warrior', 1, 1, 't', tierForRegion(regionOf(x, y)), seed);
      if (encounterGroupSize(tierForRegion(regionOf(x, y)), seed, MONSTERS_BY_ID[b.monsterId]!, true) > 1) return seed;
    }
    throw new Error('群れの seed が無い');
  };
  const far = () => { const s = worldOverlay().spawn; return { x: wrap(s.x + 40), y: s.y }; };

  it('futaba_letter_done の後だけ群れが出る (前は今のまま 1 体)', async () => {
    const env = await makeEnv();
    const { x, y } = far();
    const seed = await groupSeed(x, y);
    globalThis.fetch = pds(GS()).fn;
    const before = await sealEncounter(env, USER, GS(), x, y, seed, NOW);
    expect(before.state.enemies ?? [before.state.monster]).toHaveLength(1);
    globalThis.fetch = pds(GS({ flags: [LETTER] })).fn;
    const after = await sealEncounter(env, USER, GS({ flags: [LETTER] }), x, y, seed, NOW);
    expect(after.state.enemies!.length).toBeGreaterThan(1);
  });

  it('ふたばの近く (sky-slime 固定) とストーリー戦は今のまま', async () => {
    const env = await makeEnv();
    const s = worldOverlay().spawn;
    for (let seed = 1; seed < 300; seed++) {
      globalThis.fetch = pds(GS({ flags: [LETTER] })).fn;
      const near = await sealEncounter(env, USER, GS({ flags: [LETTER] }), s.x, wrap(s.y + 1), seed, NOW);
      expect(near.state.enemies ?? [near.state.monster]).toHaveLength(1);
    }
    setStory({ battles: [{ id: 'b-one', monsterId: 'sky-slime', count: 1, winFlag: 'w1' }] });
    const { storyBattleById } = await import('@aozoraquest/core');
    const { x, y } = far();
    const seed = await groupSeed(x, y);
    globalThis.fetch = pds(GS({ flags: [LETTER] })).fn;
    const story = await sealEncounter(env, USER, GS({ flags: [LETTER] }), x, y, seed, NOW, undefined, undefined, undefined, storyBattleById('b-one'));
    expect(story.state.enemies ?? [story.state.monster]).toHaveLength(1);
  });
});
