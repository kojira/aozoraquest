/**
 * 仲間の装備 (D-PARTY-004 B1) の edge 権威。
 * - POST /api/party/gear: 1 本しか持っていない たびのつるぎ を主人公と仲間の 2 人に → 400。2 本なら通る。
 *   職の合わない jobOnly → 400。隣り合う属性の防具 → 400 (D-ELEM-001 の関数)
 * - 主人公の /api/world/gear も、仲間が着ている品は着られない
 * - 仲間が着ている品は すてられない (400)・きたえられない (400)
 * - 仲間の装備は戦闘の atk に乗る。からだが空の仲間は ぬののふく (Lv1 から)
 * - パーティから外すと gear は消え、pieces は 1 個も減らない
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { activeEquipment, activeItems, playerCombatant, setInteriors, setItemOverrides, setMonsterOverrides, setNpcs, setStory, storyBattleById, worldOverlay, xpForAllyLevel, type EquipmentDef, type MonsterDef, type PartyRecruit } from '@aozoraquest/core';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { handleGear, sealEncounter } from '../src/battle-resolver';
import { handlePartyGear } from '../src/party-gear';
import { handlePartySet } from '../src/party-route';
import { shopDiscard, shopForge } from '../src/shop';
import { GS, guildRoom, LETTER, makeEnv, near, NOW, pds, RECEPTION, USER } from './support/party-env';

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
const MONS = [mon('a'), mon('b'), mon('c'), mon('wall', { storyOnly: true, tier: 2, hp: 9999, stats: [0, 999, 1, 1, 1] })];
const KAI: PartyRecruit = { id: 'g:k', name: 'カイ', archetype: 'warrior', star: 2, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel('warrior', 1) };
const SWORD = 'wp-travel-sword';
const piece = (rkey: string, itemId = SWORD, level = 0) => ({ rkey, itemId, level });
const sword = { weapon: { id: SWORD, level: 0 } };
const NS = 'app.aozoraquest';

describe('仲間の装備 (D-PARTY-004)', () => {
  const orig = globalThis.fetch;
  beforeAll(() => {
    setMonsterOverrides(MONS);
    setInteriors([guildRoom()], []);
    setNpcs([RECEPTION]);
    setStory({ battles: [{ id: 'b-wall', monsterId: 'wall', count: 1, winFlag: 'beat-wall' }], recruits: [{ id: 'r-1', name: 'カイト', archetype: 'warrior', guild: 'g-bluesky', line: 'よろしく。' }] });
  });
  afterAll(() => { setStory(null); setNpcs(null); setInteriors(null, null); setMonsterOverrides(TEST_MONSTERS); setItemOverrides(null); });
  afterEach(() => { globalThis.fetch = orig; setItemOverrides(null); });

  async function world(over: Partial<ReturnType<typeof GS>>) {
    const env = await makeEnv();
    const m = pds(GS({ party: { ids: [KAI.id], members: [KAI] }, ...over }));
    globalThis.fetch = m.fn;
    return { env, m };
  }

  describe('POST /api/party/gear', () => {
    it('1 本しか持っていない たびのつるぎ を主人公と仲間の 2 人に → 400。2 本なら通る', async () => {
      const one = await world({ pieces: [piece('p1')], gearSel: sword });
      await expect(handlePartyGear(one.env, USER, KAI.id, sword, NOW, NS)).rejects.toMatchObject({ status: 400, code: 'worn_by_other' });
      expect(one.m.gs().party!.gear).toBeUndefined();
      const two = await world({ pieces: [piece('p1'), piece('p2')], gearSel: sword });
      const r = await handlePartyGear(two.env, USER, KAI.id, sword, NOW, NS);
      expect(r.party.gear).toEqual({ [KAI.id]: sword });
    });

    it('主人公の /api/world/gear も、仲間が着ている品は着られない', async () => {
      const { env, m } = await world({ pieces: [piece('p1')], party: { ids: [KAI.id], members: [KAI], gear: { [KAI.id]: sword } } });
      await expect(handleGear(env, USER, sword, NOW)).rejects.toMatchObject({ status: 400, code: 'worn_by_other' });
      expect(m.gs().gearSel).toBeUndefined();
    });

    it('職の合わない jobOnly → 400', async () => {
      const only = activeEquipment().find((e) => e.jobOnly && e.jobOnly !== 'warrior' && e.slot === 'weapon')!;
      const { env } = await world({ pieces: [piece('p1', only.id)] });
      await expect(handlePartyGear(env, USER, KAI.id, { weapon: { id: only.id, level: 0 } }, NOW, NS)).rejects.toMatchObject({ status: 400, code: 'cannot_equip' });
    });

    it('隣り合う属性の防具 → 400 (D-ELEM-001 の関数)', async () => {
      const g = (id: string, slot: EquipmentDef['slot'], element: EquipmentDef['element']): EquipmentDef => ({ id, name: id, slot, kind: 'cloth', grade: 1, price: { power: 1, materials: 0 }, bonus: {}, element });
      setItemOverrides({ items: activeItems(), equipment: [...activeEquipment(), g('ar-fire', 'armor', 'fire'), g('hd-water', 'head', 'water')] });
      const { env } = await world({ pieces: [piece('p1', 'ar-fire'), piece('p2', 'hd-water')] });
      await expect(handlePartyGear(env, USER, KAI.id, { armor: { id: 'ar-fire', level: 0 }, head: { id: 'hd-water', level: 0 } }, NOW, NS)).rejects.toMatchObject({ status: 400, code: 'element_conflict' });
    });

    it('パーティにいない仲間 → 400。空の gear で はずす', async () => {
      const { env, m } = await world({ pieces: [piece('p1')], party: { ids: [KAI.id], members: [KAI], gear: { [KAI.id]: sword } } });
      await expect(handlePartyGear(env, USER, 'zz', sword, NOW, NS)).rejects.toMatchObject({ code: 'bad_request' });
      await handlePartyGear(env, USER, KAI.id, {}, NOW, NS);
      expect(m.gs().party!.gear).toBeUndefined();
    });
  });

  describe('すてる・きたえる', () => {
    const wearing = { ids: [KAI.id], members: [KAI], gear: { [KAI.id]: sword } };
    it('仲間が着ている品は すてられない (400)', async () => {
      const { env, m } = await world({ pieces: [piece('p1')], party: wearing });
      await expect(shopDiscard(env, USER, { rkeys: ['p1'], rkey: 'd1' }, NOW)).rejects.toMatchObject({ status: 400, code: 'equipped' });
      expect(m.gs().pieces).toHaveLength(1);
    });

    it('材料の 2 個が仲間の着ているぶんを割りこむなら きたえられない (400)。3 個あれば通る', async () => {
      const town = worldOverlay().towns[0]!;
      const two = await world({ x: town.x, y: town.y, pieces: [piece('p1'), piece('p2')], party: wearing });
      await expect(shopForge(two.env, USER, { rkeys: ['p1', 'p2'], rkey: 'f1' }, NOW)).rejects.toMatchObject({ status: 400, code: 'equipped' });
      const three = await world({ x: town.x, y: town.y, pieces: [piece('p1'), piece('p2'), piece('p3')], party: wearing });
      const r = await shopForge(three.env, USER, { rkeys: ['p1', 'p2'], rkey: 'f2' }, NOW);
      expect(r.level).toBe(1);
    });
  });

  describe('戦闘とパーティ', () => {
    it('仲間の装備は戦闘の atk に乗る。からだが空なら ぬののふく', async () => {
      const { env, m } = await world({ flags: [LETTER], pieces: [piece('p1')], party: { ids: [KAI.id], members: [KAI], gear: { [KAI.id]: sword } } });
      const enc = await sealEncounter(env, USER, m.gs(), 10, 10, 1, NOW, undefined, undefined, undefined, storyBattleById('b-wall'));
      const base = playerCombatant('warrior', 1, 1, 'カイ');
      expect(enc.state.allies![1]!.atk).toBe(base.atk + 7);
      expect(enc.state.allies![1]!.def).toBe(base.def + 5);
    });

    it('パーティから外すと gear は消え、pieces は 1 個も減らない', async () => {
      const env = await makeEnv();
      const m = pds(GS({ flags: [LETTER, 'yuuhi_feather_done'], pieces: [piece('p1')], party: { ids: ['r-1', KAI.id], members: [KAI], gear: { 'r-1': sword } } }));
      globalThis.fetch = m.fn;
      await handlePartySet(env, USER, 'g-bluesky', [KAI.id], near(env), NOW);
      expect(m.gs().party!.gear).toBeUndefined();
      expect(m.gs().pieces).toEqual([piece('p1')]);
    });
  });
});
