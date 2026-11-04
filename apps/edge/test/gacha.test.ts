/**
 * ギルドに来る冒険者のガチャ (D-PARTY-002) の edge 権威。
 * - 候補は読みなおしても同じ・日付が変わると別の人・引き直すと別の人
 * - 引き直しはパワー 5。readModifyWrite の中で確かめて引く。同じ rkey は 1 回だけ。足りなければ 400 not_enough_power
 * - 入れた人は候補の定義で保存 (client の送った名前は使わない)・候補の Lv から始まる
 * - その日に入れた人・はずした人は 400 recruit_gone。はずしたなじみ (parted) は候補に出てこない
 * - ids だけの古い state (なじみ) でも戦える
 * - 戦闘の経験値は出た人数で等分 (主人公も仲間も同じだけ)。Lv が上がった仲間は全快
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { allyLevel, battleXpFor, jobLevelFromXp, RECRUIT_GACHA, setInteriors, setMonsterOverrides, setNpcs, setStory, storyBattleById, xpForAllyLevel, type MonsterDef } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleTurn, sealEncounter } from '../src/battle-resolver';
import { handlePartyCandidates, handlePartyReroll, handlePartySet } from '../src/party-route';
import { dayKey } from '../src/xp-claim';
import { GS, guildRoom, LETTER, makeEnv, near, NOW, pds, RECEPTION, USER } from './support/party-env';
import type { ResolverEnv } from '../src/battle-resolver';

const CH3 = [LETTER, 'yuuhi_feather_done', 'soyogi_feather_done'];
const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
const MONS = [mon('a'), mon('b'), mon('c'), mon('boss', { storyOnly: true, tier: 2, hp: 1, stats: [1, 1, 1, 1, 1], xp: 100 })];

async function candidates(env: ResolverEnv, gs: ReturnType<typeof GS>, now = NOW) {
  globalThis.fetch = pds(gs).fn;
  return handlePartyCandidates(env, USER, 'g-bluesky', near(env, now), now);
}

describe('ギルドの候補 (D-PARTY-002)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setMonsterOverrides(MONS);
    setInteriors([guildRoom()], []);
    setNpcs([RECEPTION]);
    setStory({
      battles: [{ id: 'b-boss', monsterId: 'boss', count: 1, winFlag: 'beat-boss' }],
      recruits: [{ id: 'r-1', name: 'カイト', archetype: 'warrior', guild: 'g-bluesky', line: 'よろしく。' }],
    });
  });
  afterAll(() => { setStory(null); setNpcs(null); setInteriors(null, null); setMonsterOverrides(TEST_MONSTERS); });
  afterEach(() => { globalThis.fetch = orig; });

  it('読みなおしても同じ 3 人。日付が変わると別の人', async () => {
    const env = await makeEnv();
    const a = await candidates(env, GS({ flags: [LETTER] }));
    const b = await candidates(env, GS({ flags: [LETTER] }));
    expect(a.candidates).toHaveLength(3);
    expect(b.candidates).toEqual(a.candidates);
    expect(a.day).toBe(dayKey(NOW));
    const next = await candidates(env, GS({ flags: [LETTER] }), NOW + 86400);
    expect(next.candidates.map((c) => c.id)).not.toEqual(a.candidates.map((c) => c.id));
  });

  it('引き直すとパワーが 5 減って別の 3 人。同じ rkey の再送は 1 回ぶんだけ', async () => {
    const env = await makeEnv();
    const m = pds(GS({ flags: [LETTER], power: 12 }));
    globalThis.fetch = m.fn;
    const before = await handlePartyCandidates(env, USER, 'g-bluesky', near(env), NOW);
    const r = await handlePartyReroll(env, USER, 'g-bluesky', 'k1', near(env), NOW);
    expect(r.power).toBe(12 - RECRUIT_GACHA.rerollPower);
    expect(m.gs().power).toBe(7);
    expect(m.gs().party?.rerolls).toEqual({ day: dayKey(NOW), byGuild: { 'g-bluesky': 1 } });
    expect(r.candidates.map((c) => c.id)).not.toEqual(before.candidates.map((c) => c.id));
    const again = await handlePartyReroll(env, USER, 'g-bluesky', 'k1', near(env), NOW);
    expect(m.gs().power).toBe(7);
    expect(again.candidates).toEqual(r.candidates);
    expect(await handlePartyCandidates(env, USER, 'g-bluesky', near(env), NOW)).toMatchObject({ candidates: r.candidates });
  });

  it('パワーが 5 に足りなければ 400 not_enough_power で、何も変わらない', async () => {
    const env = await makeEnv();
    const m = pds(GS({ flags: [LETTER], power: 4 }));
    globalThis.fetch = m.fn;
    await expect(handlePartyReroll(env, USER, 'g-bluesky', 'k2', near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'not_enough_power' });
    expect(m.gs().power).toBe(4);
    expect(m.gs().party).toBeUndefined();
  });

  it('入れた人は edge の候補の定義で保存し (送った ids しか見ない)、候補の Lv から始まる。一覧からは消える', async () => {
    const env = await makeEnv();
    const gs = GS({ flags: [LETTER], jobXp: { warrior: 99999 } });
    const { candidates: list } = await candidates(env, gs);
    const pick = list.find((c) => !c.named)!;
    const m = pds(gs);
    globalThis.fetch = m.fn;
    await handlePartySet(env, USER, 'g-bluesky', [pick.id], near(env), NOW);
    const saved = m.gs().party!;
    expect(saved.ids).toEqual([pick.id]);
    expect(saved.members).toEqual([{ id: pick.id, name: pick.name, archetype: pick.archetype, star: pick.star, minLevel: pick.minLevel, line: pick.line, xp: xpForAllyLevel(pick.archetype, pick.level) }]);
    expect(allyLevel(pick.archetype, saved.members![0]!.xp)).toBe(pick.level);
    expect(saved.met).toEqual({ day: dayKey(NOW), ids: [pick.id] });
    const after = await handlePartyCandidates(env, USER, 'g-bluesky', near(env), NOW);
    expect(after.candidates.map((c) => c.id)).toEqual(list.filter((c) => c.id !== pick.id).map((c) => c.id));
  });

  it('はずした生成の人をまた入れようとすると 400 recruit_gone。経験値も消える', async () => {
    const env = await makeEnv();
    const gs = GS({ flags: [LETTER], jobXp: { warrior: 99999 } });
    const pick = (await candidates(env, gs)).candidates.find((c) => !c.named)!;
    const m = pds(gs);
    globalThis.fetch = m.fn;
    await handlePartySet(env, USER, 'g-bluesky', [pick.id], near(env), NOW);
    await handlePartySet(env, USER, 'g-bluesky', [], near(env), NOW);
    expect(m.gs().party?.members).toBeUndefined();
    expect(m.gs().party?.ids).toEqual([]);
    await expect(handlePartySet(env, USER, 'g-bluesky', [pick.id], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'recruit_gone' });
  });

  it('候補にいない id (日付の過ぎた候補・知らない人) は 400 unknown_recruit。minLevel が足りなければ recruit_level', async () => {
    const env = await makeEnv();
    const gs = GS({ flags: [LETTER], jobXp: {} });
    const list = (await candidates(env, gs)).candidates;
    globalThis.fetch = pds(gs).fn;
    await expect(handlePartySet(env, USER, 'g-bluesky', ['g:2000-01-01:g-bluesky:0:0'], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'unknown_recruit' });
    const locked = list.find((c) => c.minLevel > 1)!;
    await expect(handlePartySet(env, USER, 'g-bluesky', [locked.id], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'recruit_level' });
  });

  it('はずしたなじみ (parted) は候補に出てこず、入れようとすると recruit_gone', async () => {
    const env = await makeEnv();
    for (let day = 0; day < 40; day++) {
      const { candidates: list } = await candidates(env, GS({ flags: [LETTER], party: { ids: [], parted: ['r-1'] } }), NOW + day * 86400);
      expect(list.some((c) => c.id === 'r-1')).toBe(false);
    }
    const m = pds(GS({ flags: [LETTER], party: { ids: ['r-1'] } }));
    globalThis.fetch = m.fn;
    await handlePartySet(env, USER, 'g-bluesky', [], near(env), NOW);
    expect(m.gs().party?.parted).toEqual(['r-1']);
    await expect(handlePartySet(env, USER, 'g-bluesky', ['r-1'], near(env), NOW)).rejects.toMatchObject({ status: 400, code: 'recruit_gone' });
  });

  it('ids だけの古い state (なじみ・経験値なし) でも戦え、主人公のジョブ Lv で出る', async () => {
    const env = await makeEnv();
    const m = pds(GS({ flags: [LETTER], party: { ids: ['r-1'] } }));
    globalThis.fetch = m.fn;
    const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-boss'));
    expect(enc.state.allies).toHaveLength(2);
    expect(enc.state.allies![1]!.job?.level).toBe(jobLevelFromXp(400, 'warrior'));
  });

  describe('戦闘の経験値は人数で等分 (§11)', () => {
    const gen = (slot: number, archetype: 'mage' | 'miko', level: number) => ({ id: `g:2026-01-01:g-bluesky:0:${slot}`, name: `なかま${slot}`, archetype, star: 1 as const, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel(archetype, level) });

    async function win(party: NonNullable<ReturnType<typeof GS>['party']>) {
      const env = await makeEnv();
      const m = pds(GS({ flags: CH3, party, jobXp: { warrior: 400 } }));
      globalThis.fetch = m.fn;
      const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-boss'));
      let r;
      for (let turn = 0; turn < 50; turn++) { r = await handleTurn(env, USER, enc.battleId, turn, 'attack', NOW); if (r.outcome !== 'ongoing') break; }
      return { r: r!, gs: m.gs() };
    }

    it('3 人のパーティ: 主人公も仲間 2 人も floor(合計 / 3) ずつ', async () => {
      const a = gen(0, 'mage', 3), b = gen(1, 'miko', 3);
      const { r, gs } = await win({ ids: [a.id, b.id], members: [a, b] });
      expect(r.outcome).toBe('win');
      const share = Math.floor(battleXpFor('boss') / 3);
      expect(r.awarded?.xp).toBe(share);
      expect(gs.jobXp.warrior).toBe(400 + share);
      expect(gs.party!.members!.map((x) => x.xp)).toEqual([a.xp + share, b.xp + share]);
    });

    it('仲間の Lv が上がる (応答に出て、その仲間は全快)', async () => {
      const a = { ...gen(0, 'mage', 1), xp: xpForAllyLevel('mage', 2) - 1 };
      const { r, gs } = await win({ ids: [a.id], members: [a], hp: { [a.id]: 1 } });
      expect(r.awarded?.allyLeveledUp).toEqual([{ id: a.id, name: a.name, from: 1, to: allyLevel('mage', a.xp + Math.floor(battleXpFor('boss') / 2)) }]);
      expect(gs.party!.hp?.[a.id]).toBeUndefined();
    });

    it('なじみの経験値は party.xp に入る', async () => {
      const { gs } = await win({ ids: ['r-1'] });
      expect(gs.party!.xp?.['r-1']).toBeGreaterThan(0);
    });
  });
});
