/**
 * 倒れた仲間 (D-REVIVE-001)。
 * - 宿屋・街・そらのはね: 生きている仲間だけ全快。倒れた仲間は倒れたまま。宿の応答に いちばん近い ほこら の町
 * - ほこら: おそなえ を払い、倒れた仲間をみんな最大 HP の半分で起こす。誰も倒れていなければ払わない
 * - フィールドのどうぐ: 生き返らせるどうぐは倒れた仲間にだけ (決まった量)。回復のどうぐは決まった量
 * - 目覚めの祈り (フィールド): 倒れた仲間を起こす。MP は 3 倍
 * - 負けて町へ戻ると全員全快 (今のまま)
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  EQUIPMENT, SHRINE_REVIVE_RATIO, activeItems, partyMemberCombatant, setInteriors, setItemOverrides, setMonsterOverrides, setNpcs, setStory, skillMpCostOf, storyBattleById, worldOverlay, wrap,
  xpForAllyLevel, type MonsterDef, type PartyRecruit,
} from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleMove, handleTurn, sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { handleInnRest } from '../src/inn-rest';
import { handleFieldUse, handleShrinePray } from '../src/field-revive';
import { handleFieldSkill } from '../src/field-heal';
import { signPosition } from '../src/world-token';
import { GS, guildRoom, LETTER, makeEnv, NOW, pds, RECEPTION, USER } from './support/party-env';

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
const MONS = [mon('a'), mon('b'), mon('c'), mon('xr', { storyOnly: true, tier: 3, level: 99, hp: 9999, stats: [999, 999, 999, 1, 1] })];
const member = (id: string, archetype: PartyRecruit['archetype'], level: number): PartyRecruit => ({ id, name: id === 'g:m' ? 'ミオ' : 'カイ', archetype, star: 2, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel(archetype, level) });
const KAI = member('g:k', 'warrior', 5);
const MIO = member('g:m', 'miko', 20);
const max = (m: PartyRecruit, lv: number) => partyMemberCombatant({ ...m, level: lv }, lv).maxHp;
const FEATHER = { id: 'mezame-hane', name: 'めざめのはね', precious: true, battle: { effects: [{ kind: 'heal' as const, amount: 15, target: 'oneDownAlly' as const }] } };
const POTION = { id: 'kizu-gusuri', name: 'きずぐすり', battle: { effects: [{ kind: 'heal' as const, amount: 6 }] } };
const room = () => ({ ...guildRoom(), inn: { x: 5, y: 5, price: 3 }, shrine: { x: 2, y: 2, price: 8, name: 'ほこら' } });

describe('倒れた仲間 (D-REVIVE-001)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setMonsterOverrides(MONS);
    setInteriors([room()], []);
    setNpcs([RECEPTION]);
    setStory({ battles: [{ id: 'b-x', monsterId: 'xr', count: 1, winFlag: 'beat-x', canFlee: false }], recruits: [] });
    setItemOverrides({ items: [...activeItems(), FEATHER, POTION], equipment: [...EQUIPMENT] });
  });
  afterAll(() => { setStory(null); setNpcs(null); setInteriors(null, null); setMonsterOverrides(TEST_MONSTERS); setItemOverrides(null); });
  afterEach(() => { globalThis.fetch = orig; });
  const down = { ids: ['g:k', 'g:m'], members: [KAI, MIO], hp: { 'g:k': 0, 'g:m': 3 }, mp: { 'g:m': 1 } };

  it('宿屋: 生きている仲間だけ全快し、倒れた仲間は倒れたまま。倒れた人の数を返す', async () => {
    const env = await makeEnv();
    const m = pds(GS({ mapId: 'g-town', x: 5, y: 5, party: down }));
    globalThis.fetch = m.fn;
    const r = await handleInnRest(env, USER, undefined, NOW);
    expect(r.inn?.paid).toBe(3);
    expect(r.downed?.count).toBe(1);
    expect(m.gs().party?.hp).toEqual({ 'g:k': 0 });
    expect(m.gs().party?.mp).toBeUndefined();
  });

  it('宿屋: 倒れた仲間しか弱っていなければ払わない (泊まっても起きない)', async () => {
    const env = await makeEnv();
    const m = pds(GS({ mapId: 'g-town', x: 5, y: 5, party: { ids: ['g:k'], members: [KAI], hp: { 'g:k': 0 } } }));
    globalThis.fetch = m.fn;
    const r = await handleInnRest(env, USER, undefined, NOW);
    expect(r.inn?.paid).toBe(0);
    expect(r.downed?.count).toBe(1);
  });

  it('街に入っても倒れた仲間は起きない', async () => {
    const env = await makeEnv();
    const spawn = worldOverlay().spawn;
    const tok = signPosition(env, { did: USER, x: spawn.x, y: wrap(spawn.y + 1), counter: 1, iat: NOW });
    const m = pds(GS({ x: spawn.x, y: wrap(spawn.y + 1), party: down }));
    globalThis.fetch = m.fn;
    await handleMove(env, USER, 0, -1, tok, NOW);
    expect(m.gs().party?.hp).toEqual({ 'g:k': 0 });
  });

  it('ほこら: おそなえ を払い、倒れた仲間を最大 HP の半分で起こす。もう一度は払わない', async () => {
    const env = await makeEnv();
    const m = pds(GS({ mapId: 'g-town', x: 2, y: 2, power: 20, party: down }));
    globalThis.fetch = m.fn;
    const r = await handleShrinePray(env, USER, { rkey: 'p1' }, NOW, 'app.aozoraquest');
    const lv = 5;
    expect(r.paid).toBe(8);
    expect(r.revived).toEqual([{ id: 'g:k', name: 'カイ', hp: Math.round(max(KAI, lv) * SHRINE_REVIVE_RATIO) }]);
    expect(m.gs().power).toBe(12);
    expect(m.gs().party?.hp?.['g:k']).toBe(r.revived[0]!.hp);
    const again = await handleShrinePray(env, USER, { rkey: 'p2' }, NOW, 'app.aozoraquest');
    expect(again.paid).toBe(0);
    expect(m.gs().power).toBe(12);
  });

  it('ほこら: パワーが足りなければ起こさない・ほこらの上にいなければ 400', async () => {
    const env = await makeEnv();
    const m = pds(GS({ mapId: 'g-town', x: 2, y: 2, power: 3, party: down }));
    globalThis.fetch = m.fn;
    const r = await handleShrinePray(env, USER, { rkey: 'p1' }, NOW, 'app.aozoraquest');
    expect(r.denied?.price).toBe(8);
    expect(m.gs().party?.hp?.['g:k']).toBe(0);
    globalThis.fetch = pds(GS({ mapId: 'g-town', x: 3, y: 3, power: 20, party: down })).fn;
    await expect(handleShrinePray(env, USER, { rkey: 'p1' }, NOW, 'app.aozoraquest')).rejects.toMatchObject({ status: 400, code: 'not_at_shrine' });
  });

  it('フィールド: めざめのはね は倒れた仲間を決まった量で起こし、生きている人には使えない', async () => {
    const env = await makeEnv();
    const m = pds(GS({ materials: { 'mezame-hane': 1 }, party: down }));
    globalThis.fetch = m.fn;
    await expect(handleFieldUse(env, USER, { itemId: 'mezame-hane', target: 'g:m', rkey: 'u0' }, NOW, 'app.aozoraquest')).rejects.toMatchObject({ code: 'target_up' });
    const r = await handleFieldUse(env, USER, { itemId: 'mezame-hane', target: 'g:k', rkey: 'u1' }, NOW, 'app.aozoraquest');
    expect(r.revived).toBe(true);
    expect(m.gs().party?.hp?.['g:k']).toBe(15);
    expect(m.gs().materials['mezame-hane']).toBeUndefined();
  });

  it('フィールド: 回復のどうぐは決まった量・倒れた人には使えない', async () => {
    const env = await makeEnv();
    const m = pds(GS({ materials: { 'kizu-gusuri': 2 }, party: down }));
    globalThis.fetch = m.fn;
    await expect(handleFieldUse(env, USER, { itemId: 'kizu-gusuri', target: 'g:k', rkey: 'u0' }, NOW, 'app.aozoraquest')).rejects.toMatchObject({ code: 'target_down' });
    await handleFieldUse(env, USER, { itemId: 'kizu-gusuri', target: 'g:m', rkey: 'u1' }, NOW, 'app.aozoraquest');
    expect(m.gs().party?.hp?.['g:m']).toBe(9);
  });

  it('フィールド: 目覚めの祈り は倒れた仲間を起こし、MP を 3 倍使う', async () => {
    const env = await makeEnv();
    const mio = partyMemberCombatant({ ...MIO, level: 20 }, 20);
    const m = pds(GS({ party: { ids: ['g:k', 'g:m'], members: [KAI, MIO], hp: { 'g:k': 0 } } }));
    globalThis.fetch = m.fn;
    const r = await handleFieldSkill(env, USER, { caster: 'g:m', skillId: 'revive-prayer', target: 'g:k', rkey: 's1' }, NOW);
    expect(r.healed[0]!.id).toBe('g:k');
    expect(m.gs().party?.hp?.['g:k']).toBe(Math.round(max(KAI, 5) * 0.3));
    expect(m.gs().party?.mp?.['g:m']).toBe(mio.maxMp - skillMpCostOf(mio, 'revive-prayer'));
  });

  it('負けて町へ戻ると、倒れた仲間も全快 (町の人が運んでくれた)', async () => {
    const env = await makeEnv();
    const m = pds(GS({ flags: [LETTER], party: { ids: ['g:m'], members: [MIO], hp: { 'g:m': 2 } } }));
    globalThis.fetch = m.fn;
    const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-x'));
    let r;
    for (let t = 0; t < 50; t++) { r = await handleTurn(env, USER, enc.battleId, t, 'attack', NOW); if (r.outcome !== 'ongoing') break; }
    expect(r!.outcome).toBe('lose');
    expect(m.gs().party?.hp).toBeUndefined();
  });
});
