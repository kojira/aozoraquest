/**
 * さくせん・めいれい の edge 権威 (D-PARTY-004 A3)。
 * - POST /api/party/mode: ♥2 未満の さくせん・♥3 未満の めいれい → 400 bond_too_low。null で おまかせ。外すと消える
 * - 封印: mode は allyModes に、めいれい の仲間は sealed.manual に (戦闘中に変えても この戦闘には効かない)
 * - handleTurn の allies[]: 無しは今と同じ。♥3 (封印で めいれい) でない仲間 → 400。flee → 400。知らない id → 400。
 *   範囲外の skillIndex は 0 に
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setInteriors, setMonsterOverrides, setNpcs, setStory, skillsForJob, storyBattleById, type MonsterDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleTurn, sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { handlePartyMode } from '../src/party-orders-route';
import { handlePartySet } from '../src/party-route';
import { GS, guildRoom, LETTER, makeEnv, near, NOW, pds, RECEPTION, USER } from './support/party-env';

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
const MONS = [mon('a'), mon('b'), mon('c'), mon('wall', { storyOnly: true, tier: 2, hp: 9999, stats: [0, 999, 1, 1, 1] })];
const CH2 = [LETTER, 'yuuhi_feather_done'];

describe('さくせん・めいれい (D-PARTY-004)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setMonsterOverrides(MONS);
    setInteriors([guildRoom()], []);
    setNpcs([RECEPTION]);
    setStory({
      battles: [{ id: 'b-wall', monsterId: 'wall', count: 1, winFlag: 'beat-wall' }],
      recruits: [
        { id: 'r-1', name: 'カイト', archetype: 'warrior', guild: 'g-bluesky', line: 'よろしく。' },
        { id: 'r-2', name: 'ミオ', archetype: 'miko', guild: 'g-bluesky', line: 'よろしく。' },
      ],
    });
  });
  afterAll(() => { setStory(null); setNpcs(null); setInteriors(null, null); setMonsterOverrides(TEST_MONSTERS); });
  afterEach(() => { globalThis.fetch = orig; });

  describe('POST /api/party/mode', () => {
    async function setMode(bond: number, mode: unknown) {
      const env = await makeEnv();
      const m = pds(GS({ party: { ids: ['r-1'], bond: { 'r-1': bond } } }));
      globalThis.fetch = m.fn;
      return { run: () => handlePartyMode(env, USER, 'r-1', mode, NOW, 'app.aozoraquest'), gs: m.gs };
    }

    it('♥2 未満の さくせん は 400 bond_too_low。♥2 なら書ける', async () => {
      await expect((await setMode(59, 'inochi')).run()).rejects.toMatchObject({ status: 400, code: 'bond_too_low' });
      const ok = await setMode(60, 'inochi');
      expect((await ok.run()).party.mode).toEqual({ 'r-1': 'inochi' });
      expect(ok.gs().party!.mode).toEqual({ 'r-1': 'inochi' });
    });

    it('♥3 未満の めいれい は 400。♥3 なら書ける。null で おまかせ に戻る', async () => {
      await expect((await setMode(149, 'manual')).run()).rejects.toMatchObject({ code: 'bond_too_low' });
      const env = await makeEnv();
      const m = pds(GS({ party: { ids: ['r-1'], bond: { 'r-1': 150 }, mode: { 'r-1': 'gangan' } } }));
      globalThis.fetch = m.fn;
      await handlePartyMode(env, USER, 'r-1', 'manual', NOW, 'app.aozoraquest');
      expect(m.gs().party!.mode).toEqual({ 'r-1': 'manual' });
      await handlePartyMode(env, USER, 'r-1', null, NOW, 'app.aozoraquest');
      expect(m.gs().party!.mode).toBeUndefined();
    });

    it('知らない mode・パーティにいない仲間は 400', async () => {
      await expect((await setMode(150, 'zzz')).run()).rejects.toMatchObject({ code: 'bad_request' });
      const env = await makeEnv();
      globalThis.fetch = pds(GS({ party: { ids: ['r-1'], bond: { 'r-1': 150 } } })).fn;
      await expect(handlePartyMode(env, USER, 'r-2', 'gangan', NOW, 'app.aozoraquest')).rejects.toMatchObject({ code: 'bad_request' });
    });

    it('パーティから外すと mode も消える', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: CH2, party: { ids: ['r-1', 'r-2'], mode: { 'r-1': 'gangan', 'r-2': 'manual' } } }));
      globalThis.fetch = m.fn;
      await handlePartySet(env, USER, 'g-bluesky', ['r-1'], near(env), NOW);
      expect(m.gs().party!.mode).toEqual({ 'r-1': 'gangan' });
    });
  });

  describe('戦闘の allies[]', () => {
    async function seal(party: NonNullable<ReturnType<typeof GS>['party']>) {
      const env: ResolverEnv = await makeEnv();
      const m = pds(GS({ flags: CH2, party }));
      globalThis.fetch = m.fn;
      const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-wall'));
      return { env, enc, m, turn: (allies?: unknown) => handleTurn(env, USER, enc.battleId, 0, 'guard', NOW, undefined, 0, 0, undefined, allies) };
    }
    const manualParty = { ids: ['r-1', 'r-2'], bond: { 'r-1': 150, 'r-2': 150 }, mode: { 'r-1': 'manual' as const, 'r-2': 'jumon' as const } };

    it('封印で allyModes と sealed.manual が入る', async () => {
      const { enc, m } = await seal(manualParty);
      expect(enc.state.allyModes).toEqual([undefined, 'manual', 'jumon']);
      expect(enc.state.partyIds).toEqual(['r-1', 'r-2']);
      expect((m.guard() as unknown as { sealed: { manual?: string[] } }).sealed.manual).toEqual(['r-1']);
    });

    it('めいれい の仲間は選んだ手で動く', async () => {
      const { turn } = await seal(manualParty);
      const r = await turn([{ id: 'r-1', command: 'guard' }]);
      expect(r.events.some((e) => e.text === 'カイトはぼうぎょのかまえ!')).toBe(true);
    });

    it('めいれい でない仲間 (さくせん) の allies[] → 400。flee → 400。知らない id → 400。重複 → 400', async () => {
      for (const allies of [[{ id: 'r-2', command: 'guard' }], [{ id: 'r-1', command: 'flee' }], [{ id: 'zz', command: 'guard' }], [{ id: 'r-1', command: 'guard' }, { id: 'r-1', command: 'attack' }], 'x']) {
        const { turn } = await seal(manualParty);
        await expect(turn(allies)).rejects.toMatchObject({ status: 400, code: 'bad_ally_order' });
      }
    });

    it('範囲外の skillIndex は 0 (その仲間のとくぎの範囲)', async () => {
      const { turn } = await seal(manualParty);
      const r = await turn([{ id: 'r-1', command: 'skill', skillIndex: 99 }]);
      const first = skillsForJob('warrior', r.state.allies![1]!.job!.level)[0]!;
      expect(r.events.some((e) => e.text.includes(first.name))).toBe(true);
    });

    it('allies[] 無しは 今と同じ (めいれい の仲間も おまかせ で埋める)', async () => {
      const { turn } = await seal(manualParty);
      const r = await turn(undefined);
      expect(r.outcome).toBe('ongoing');
      expect(r.events.some((e) => e.text.startsWith('カイト'))).toBe(true);
    });
  });
});
