import { afterEach, describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  EQUIPMENT,
  EQUIPMENT_BY_ID,
  canEquip,
  jobGradeSet,
  maxShopGradeForTier,
  TIER_LEVEL,
  activeItems,
  setItemOverrides,
  setMonsterOverrides,
  tierForRegion,
  townShopStock,
  worldOverlay,
  type EquipmentDef,
  type MonsterDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

/** D-ENDGAME-001 PR2: tier4 以上の店に「自分のジョブの専用品」の枠を 1 つ足す (d-gear-002 決めること 4)。 */

const deepMonsters = (): MonsterDef[] => {
  const extra: MonsterDef[] = [];
  for (const tier of [4, 5, 6] as const) for (let i = 0; i < 3; i++) {
    extra.push({ id: `deep-${tier}-${i}`, name: `ふかい${tier}-${i}`, species: 'slime', tint: `#00${tier}${i}00`, level: TIER_LEVEL[tier], tier, stats: [40, 30, 20, 10, 10], hp: 30, xp: 60 + tier * 10, drops: [], intro: 'て。' });
  }
  return [...TEST_MONSTERS, ...extra];
};
/** 16 職 × g4〜6 の専用品 (dev の world.items と同じ id の形)。 */
const jobGear = (): EquipmentDef[] => ARCHETYPES.flatMap((job) => [4, 5, 6].map((g) => ({
  id: `wp-${job}-g${g}`, name: `${job}-g${g}`, slot: 'weapon' as const, kind: 'exclusive' as const, jobOnly: job, grade: g as 4 | 5 | 6, bonus: { atk: g * 10 }, price: { power: 1, materials: 0 },
})));

describe('tier4 以上の店の、自分のジョブの枠', () => {
  afterEach(() => { setMonsterOverrides(TEST_MONSTERS); setItemOverrides(null); });
  const BASE = EQUIPMENT.map((e) => ({ ...e }));
  const setup = () => {
    setMonsterOverrides(deepMonsters());
    setItemOverrides({ items: activeItems(), equipment: [...BASE, ...jobGear()] });
    return worldOverlay().towns.map((t, i) => ({ t, i, tier: tierForRegion(t.region) }));
  };

  it('職を渡すと、その店の grade の自分の専用品が 1 つ増える (ほかの職の品は増えない)', () => {
    const towns = setup().filter((x) => x.tier >= 4);
    expect(towns.length).toBeGreaterThanOrEqual(4);
    for (const { t, i, tier } of towns) {
      const base = townShopStock(t, i).equipment;
      for (const job of ARCHETYPES) {
        const mine = townShopStock(t, i, job).equipment;
        const added = mine.filter((id) => !base.includes(id));
        expect(added, `${t.name} ${job}`).toEqual([`wp-${job}-g${tier}`]);
      }
    }
  });

  it('tier1 の店は、職を渡さないときと同じ', () => {
    for (const { t, i, tier } of setup()) {
      if (tier >= 2) continue;
      expect(townShopStock(t, i, 'sage').equipment, t.name).toEqual(townShopStock(t, i).equipment);
    }
  });

  it('tier2 以上の店は、買う人の職の その grade の 1 式 (武器・頭・胴。盾・足・お守りはデータにあれば) を並べる (D-REVIVE-001 addendum 3)', () => {
    for (const { t, i, tier } of setup()) {
      if (tier < 2) continue;
      for (const job of ['warrior', 'mage', 'guardian'] as const) {
        const set = jobGradeSet(job, maxShopGradeForTier(tier));
        if (tier === 2) expect(set.map((id) => EQUIPMENT_BY_ID[id]!.slot), `${t.name} ${job}`).toEqual(expect.arrayContaining(['weapon', 'head', 'armor']));
        expect(townShopStock(t, i, job).equipment, `${t.name} ${job}`).toEqual(expect.arrayContaining(set));
        for (const id of set) expect(canEquip(job, EQUIPMENT_BY_ID[id]!)).toBe(true);
      }
    }
  });

  it('その職の品がデータに無ければ足さない (壊れた参照を作らない)', () => {
    const towns = setup().filter((x) => x.tier >= 4);
    setItemOverrides({ items: activeItems(), equipment: [...BASE, ...jobGear().filter((e) => e.jobOnly !== 'miko')] });
    for (const { t, i } of towns) expect(townShopStock(t, i, 'miko').equipment).toEqual(townShopStock(t, i).equipment);
  });
});
