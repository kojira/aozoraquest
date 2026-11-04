/**
 * きずな (D-PARTY-004) の edge 権威。
 * - 戦闘に出た仲間は決着ごとに +1 (勝ち・負け・にげる)。倒れていて出なかった仲間は 0
 * - クエストの報告で、その時パーティにいる全員に 本編 +10・それ以外 +5。もう達成していた (already_done) 時は 0
 * - ♥ が増えたら応答の allyBondUp に出る
 * - パーティから外すと bond・bondHeal が消える
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setGameQuests, setInteriors, setMonsterOverrides, setNpcs, setScenario, setStory, storyBattleById, type MonsterDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleTurn, sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { handleQuestComplete } from '../src/game-quest';
import { handlePartySet } from '../src/party-route';
import { partyWithBattleBond } from '../src/party-bond';
import { GS, guildRoom, LETTER, makeEnv, near, NOW, pds, RECEPTION, USER } from './support/party-env';

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
const MONS = [mon('a'), mon('b'), mon('c'),
  mon('weak', { storyOnly: true, tier: 2, hp: 1, stats: [1, 1, 1, 1, 1] }),
  mon('slow', { storyOnly: true, tier: 2, hp: 9999, stats: [1, 999, 1, 1, 1] }),
  mon('brute', { storyOnly: true, tier: 3, level: 99, hp: 9999, stats: [999, 999, 999, 1, 1] })];
const CH2 = [LETTER, 'yuuhi_feather_done'];

async function settle(env: ResolverEnv, battleId: string, command: 'attack' | 'guard' | 'flee') {
  for (let turn = 0; turn < 300; turn++) {
    const r = await handleTurn(env, USER, battleId, turn, command, NOW);
    if (r.outcome !== 'ongoing') return r;
  }
  throw new Error('決着しない');
}

describe('きずな (D-PARTY-004)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setMonsterOverrides(MONS);
    setInteriors([guildRoom()], []);
    setNpcs([RECEPTION, { id: 'npc-q', name: 'むらびと', x: 5, y: 5, lines: ['やあ'] }]);
    setStory({
      battles: [
        { id: 'b-weak', monsterId: 'weak', count: 1, winFlag: 'beat-weak' },
        { id: 'b-slow', monsterId: 'slow', count: 1, winFlag: 'beat-slow' },
        { id: 'b-brute', monsterId: 'brute', count: 1, winFlag: 'beat-brute' },
      ],
      recruits: [
        { id: 'r-1', name: 'カイト', archetype: 'warrior', guild: 'g-bluesky', line: 'よろしく。' },
        { id: 'r-2', name: 'ミオ', archetype: 'miko', guild: 'g-bluesky', line: 'よろしく。' },
      ],
    });
    const q = (id: string) => ({ id, title: id, npcId: 'npc-q', intro: ['たのむ'], done: ['ありがとう'], objective: { kind: 'collect' as const, itemId: 'herb', count: 1 } });
    setGameQuests([q('q-main'), q('q-side')]);
    setScenario([{ id: 'e-main', title: '章', when: [{ kind: 'questDone', questId: 'q-main' }], setFlags: ['ch-main'] }]);
  });
  afterAll(() => { setScenario(null); setGameQuests(null); setStory(null); setNpcs(null); setInteriors(null, null); setMonsterOverrides(TEST_MONSTERS); });
  afterEach(() => { globalThis.fetch = orig; });

  async function battle(story: string, command: 'attack' | 'guard' | 'flee', party = { ids: ['r-1', 'r-2'], hp: { 'r-2': 0 } } as NonNullable<ReturnType<typeof GS>['party']>) {
    const env = await makeEnv();
    const m = pds(GS({ flags: CH2, party }));
    globalThis.fetch = m.fn;
    const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById(story));
    const r = await settle(env, enc.battleId, command);
    return { r, gs: m.gs() };
  }

  it('勝ち: 出た仲間は +1、倒れていて出なかった仲間は 0', async () => {
    const { r, gs } = await battle('b-weak', 'attack');
    expect(r.outcome).toBe('win');
    expect(gs.party!.bond).toEqual({ 'r-1': 1 });
  });

  it('負け: 出た仲間は +1 (負けて全快しても きずな は残る)', async () => {
    const { r, gs } = await battle('b-brute', 'guard', { ids: ['r-1'], bond: { 'r-1': 5 } });
    expect(r.outcome).toBe('lose');
    expect(gs.party!.bond).toEqual({ 'r-1': 6 });
  });

  it('にげる: 出た仲間は +1', async () => {
    const { r, gs } = await battle('b-slow', 'flee', { ids: ['r-1'] });
    expect(r.outcome).toBe('fled');
    expect(gs.party!.bond).toEqual({ 'r-1': 1 });
  });

  it('♥ が増えたら応答の allyBondUp に出る', async () => {
    const { r } = await battle('b-weak', 'attack', { ids: ['r-1'], bond: { 'r-1': 19 } });
    expect(r.awarded?.allyBondUp).toEqual([{ id: 'r-1', name: 'カイト', hearts: 1 }]);
  });

  it('戦闘中にほかの人から 最大 HP の 50% を受けた仲間は、出た +1 と回復の +2 (healReceived は allies の位置)', () => {
    const battle = { healReceived: [0.9, 0.5, 0.1] } as unknown as Parameters<typeof partyWithBattleBond>[2];
    const r = partyWithBattleBond({ ids: ['r-1', 'r-2'] }, ['r-1', 'r-2'], battle);
    expect(r.party!.bond).toEqual({ 'r-1': 3, 'r-2': 1 });
    expect(r.party!.bondHeal).toEqual({ 'r-2': 100 });
  });

  describe('クエストの報告', () => {
    async function report(questId: string, over: Partial<ReturnType<typeof GS>> = {}) {
      const env = await makeEnv();
      const m = pds(GS({ materials: { herb: 1 }, activeQuests: [{ id: questId, progress: 0 }], party: { ids: ['r-1', 'r-2'], bond: { 'r-2': 55 } }, ...over }));
      globalThis.fetch = m.fn;
      return { res: await handleQuestComplete(env, USER, questId, NOW), gs: m.gs() };
    }

    it('本編 (シナリオの questDone にある) は全員 +10。♥ が増えた人は allyBondUp', async () => {
      const { res, gs } = await report('q-main');
      expect(gs.party!.bond).toEqual({ 'r-1': 10, 'r-2': 65 });
      expect(res.allyBondUp).toEqual([{ id: 'r-2', name: 'ミオ', hearts: 2 }]);
      expect(res.party?.bond).toEqual(gs.party!.bond);
    });

    it('それ以外は全員 +5', async () => {
      const { gs } = await report('q-side');
      expect(gs.party!.bond).toEqual({ 'r-1': 5, 'r-2': 60 });
    });

    it('もう達成していた (already_done) 時は 0', async () => {
      const env = await makeEnv();
      const m = pds(GS({ materials: { herb: 1 }, questsDone: ['q-main'], party: { ids: ['r-1'] } }));
      globalThis.fetch = m.fn;
      await expect(handleQuestComplete(env, USER, 'q-main', NOW)).rejects.toMatchObject({ code: 'already_done' });
      expect(m.gs().party!.bond).toBeUndefined();
    });
  });

  it('パーティから外すと その人の bond・bondHeal が消える', async () => {
    const env = await makeEnv();
    const m = pds(GS({ flags: CH2, party: { ids: ['r-1', 'r-2'], bond: { 'r-1': 30, 'r-2': 70 }, bondHeal: { 'r-1': 100, 'r-2': 200 } } }));
    globalThis.fetch = m.fn;
    await handlePartySet(env, USER, 'g-bluesky', ['r-1'], near(env), NOW);
    expect(m.gs().party).toMatchObject({ ids: ['r-1'], bond: { 'r-1': 30 }, bondHeal: { 'r-1': 100 } });
  });
});
