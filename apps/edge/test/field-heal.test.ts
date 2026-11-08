/**
 * フィールドの回復 (D-PARTY-003)。
 * - POST /api/world/item の target: やくそうを仲間に使うと party.hp[id] が上がる。倒れた仲間は 400
 * - POST /api/world/skill: 唱えた人の MP を持ちこしから引き、相手を戦闘と同じ量だけ回復。全体回復は全員
 *   MP 不足・倒れた相手・覚えていない/回復でないとくぎは 400。同じ rkey の再送は 1 回だけ
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BATTLE_TUNING, jobLevelFromXp, normalizeStats, partyMemberCombatant, playerCombatant, playerLevelFromXp, skillMpCostOf, statVectorToArray, xpForAllyLevel, type PartyRecruit } from '@aozoraquest/core';
import { handleFieldSkill, handleItem } from '../src/field-heal';
import { GS, makeEnv, NOW, pds, USER } from './support/party-env';

const member = (id: string, archetype: PartyRecruit['archetype'], level: number): PartyRecruit => ({ id, name: id === 'g:p' ? 'ハル' : 'ミオ', archetype, star: 2, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel(archetype, level) });
const PAL = member('g:p', 'paladin', 5);
const MIKO = member('g:m', 'miko', 5);
const maxOf = (m: PartyRecruit, lv = 5) => partyMemberCombatant({ ...m, level: lv }, lv);
/** party-env の診断 (warrior・jobXp 400) と同じ組み立ての主人公。 */
const heroMax = () => playerCombatant('warrior', jobLevelFromXp(400, 'warrior'), playerLevelFromXp(0), USER, statVectorToArray(normalizeStats({ atk: 30, def: 25, agi: 15, int: 15, luk: 15 }))).maxHp;

describe('フィールドの回復 (D-PARTY-003)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('やくそうを仲間に使うと party.hp[id] が上がり、主人公の carryHp は動かない', async () => {
    const env = await makeEnv();
    const m = pds(GS({ materials: { herb: 2 }, carryHp: 3, party: { ids: ['g:p'], members: [PAL], hp: { 'g:p': 2 } } }));
    globalThis.fetch = m.fn;
    const r = await handleItem(env, USER, 'herb', NOW, undefined, undefined, 'g:p');
    const max = maxOf(PAL).maxHp;
    const want = Math.min(max, 2 + Math.round(max * BATTLE_TUNING.herbHealRatio));
    expect(m.gs().party?.hp?.['g:p'] ?? max).toBe(want);
    expect(r.healed).toBe(want - 2);
    expect(m.gs().carryHp).toBe(3);
    expect(m.gs().materials.herb).toBe(1);
  });

  it('倒れた仲間 (HP 0) にはやくそうを使えず 400、数は動かない', async () => {
    const env = await makeEnv();
    const m = pds(GS({ materials: { herb: 2 }, party: { ids: ['g:p'], members: [PAL], hp: { 'g:p': 0 } } }));
    globalThis.fetch = m.fn;
    await expect(handleItem(env, USER, 'herb', NOW, undefined, undefined, 'g:p')).rejects.toMatchObject({ status: 400, code: 'target_down' });
    expect(m.gs().materials.herb).toBe(2);
  });

  it('仲間の 聖光の癒し: 唱えた仲間の MP を引き、主人公を 戦闘と同じ量だけ回復', async () => {
    const env = await makeEnv();
    const m = pds(GS({ carryHp: 2, party: { ids: ['g:p'], members: [PAL] } }));
    globalThis.fetch = m.fn;
    const r = await handleFieldSkill(env, USER, { caster: 'g:p', skillId: 'paladin-heal', target: 'hero', rkey: 'k1' }, NOW);
    const caster = maxOf(PAL);
    const amount = Math.round(heroMax() * 0.3);
    expect(m.gs().party?.mp?.['g:p']).toBe(caster.maxMp - skillMpCostOf(caster));
    expect(r.healed).toEqual([{ id: 'hero', name: USER, amount }]);
    expect(m.gs().carryHp).toBe(2 + amount);
    expect(r).toMatchObject({ casterName: 'ハル', skillName: '聖光の癒し' });
  });

  it('巫女の 癒しの鈴 は生きている全員を回復 (倒れた仲間はそのまま)', async () => {
    const env = await makeEnv();
    const m = pds(GS({ carryHp: 2, party: { ids: ['g:m', 'g:p'], members: [MIKO, PAL], hp: { 'g:m': 3, 'g:p': 0 } } }));
    globalThis.fetch = m.fn;
    const r = await handleFieldSkill(env, USER, { caster: 'g:m', skillId: 'miko-heal-bell', rkey: 'k1' }, NOW);
    expect(r.healed.map((h) => h.id)).toEqual(['hero', 'g:m']);
    const miko = maxOf(MIKO);
    expect(m.gs().party?.hp?.['g:m']).toBe(Math.min(miko.maxHp, 3 + Math.round(miko.maxHp * 0.2)));
    expect(m.gs().party?.hp?.['g:p']).toBe(0);
  });

  it('同じ rkey の再送は 1 回だけ (MP も HP も 1 回ぶん)', async () => {
    const env = await makeEnv();
    const m = pds(GS({ carryHp: 2, party: { ids: ['g:p'], members: [PAL] } }));
    globalThis.fetch = m.fn;
    await handleFieldSkill(env, USER, { caster: 'g:p', skillId: 'paladin-heal', target: 'hero', rkey: 'same' }, NOW);
    const once = { hp: m.gs().carryHp, mp: m.gs().party?.mp?.['g:p'] };
    const again = await handleFieldSkill(env, USER, { caster: 'g:p', skillId: 'paladin-heal', target: 'hero', rkey: 'same' }, NOW);
    expect(again.duplicate).toBe(true);
    expect({ hp: m.gs().carryHp, mp: m.gs().party?.mp?.['g:p'] }).toEqual(once);
  });

  it('MP が足りない・倒れた相手・覚えていない/回復でない/知らないとくぎは 400 で、state は動かない', async () => {
    const env = await makeEnv();
    const seed = GS({ carryHp: 2, party: { ids: ['g:p', 'g:m'], members: [PAL, MIKO], mp: { 'g:p': 0 }, hp: { 'g:m': 0 } } });
    const m = pds(seed);
    globalThis.fetch = m.fn;
    const call = (input: Record<string, unknown>) => handleFieldSkill(env, USER, { rkey: 'k', ...input }, NOW);
    await expect(call({ caster: 'g:p', skillId: 'paladin-heal', target: 'hero' })).rejects.toMatchObject({ status: 400, code: 'not_enough_mp' });
    globalThis.fetch = pds(GS({ carryHp: 2, party: { ids: ['g:p', 'g:m'], members: [PAL, MIKO], hp: { 'g:m': 0 } } })).fn;
    await expect(call({ caster: 'g:p', skillId: 'paladin-heal', target: 'g:m' })).rejects.toMatchObject({ status: 400, code: 'target_down' });
    await expect(call({ caster: 'g:p', skillId: 'sage-heal', target: 'hero' })).rejects.toMatchObject({ status: 400, code: 'unknown_skill' });
    await expect(call({ caster: 'g:p', skillId: 'nope', target: 'hero' })).rejects.toMatchObject({ status: 400, code: 'unknown_skill' });
    await expect(call({ caster: 'g:p', skillId: 'paladin-blessing', target: 'hero' })).rejects.toMatchObject({ status: 400, code: 'not_heal_skill' });
    await expect(call({ caster: 'g:x', skillId: 'paladin-heal', target: 'hero' })).rejects.toMatchObject({ status: 400, code: 'bad_target' });
    await expect(call({ caster: 'g:p', skillId: 'paladin-heal', target: 'hero', rkey: '' })).rejects.toMatchObject({ status: 400, code: 'bad_request' });
    expect(m.gs()).toEqual(seed);
  });
});
