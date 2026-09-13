import { afterEach, describe, expect, it } from 'vitest';
import {
  starterTownQuests, starterTownScenario, starterTownNpcs, starterTownShop,
  setNpcs, setGameQuests, setScenario, setShopOverrides, gameQuests, scenarioEvents,
  validateGameQuests, validateScenario, pendingScenario, SAMPLE_SCENARIO,
  townShopStock, worldOverlay, EQUIPMENT_BY_ID, JOBS, canEquip, npcLinesFor,
} from '../index.js';

afterEach(() => { setScenario(null); setGameQuests(null); setNpcs(null); setShopOverrides(null); });

describe('ふたばの村の導入データ', () => {
  it('保存前の検証は定義を変えず、報告だけで次の依頼が解禁される', () => {
    setNpcs(starterTownNpcs());
    const quests = starterTownQuests();
    validateGameQuests(quests);
    expect(gameQuests()).toEqual([]);
    setGameQuests(quests);
    const events = [...SAMPLE_SCENARIO, ...starterTownScenario()];
    validateScenario(events);
    expect(scenarioEvents()).toEqual([]);
    setScenario(starterTownScenario());
    const p = { flags: [] as string[], questsDone: [] as string[], jobXpLevels: {}, materials: {} };
    expect(pendingScenario(p).fired).toEqual([]);
    expect(quests[0]!.requireFlags).toBeUndefined();
    for (const [i, q] of quests.entries()) {
      expect((q.requireFlags ?? []).every((f) => p.flags.includes(f))).toBe(true);
      p.questsDone.push(q.id);
      const { fired } = pendingScenario(p);
      expect(fired).toHaveLength(1);
      p.flags.push(...fired[0]!.setFlags);
      expect(pendingScenario(p).fired).toEqual([]);
      if (i < 2) expect(quests[i + 1]!.requireFlags).toEqual(fired[0]!.setFlags);
    }
    const elder = starterTownNpcs()[0]!;
    expect(npcLinesFor(elder, p.flags, {}).join('')).toContain('じぶんの ペース');
  });

  it('第1報酬で全職のぬののふくを作れる設定。既存品・店主は保持', () => {
    const town = worldOverlay().towns[0]!;
    const stock = townShopStock(town, 0);
    const existing = { x: town.x, y: town.y, keeper: { name: '店主' } };
    const over = starterTownShop(town, stock, existing);
    expect(over.keeper).toEqual(existing.keeper);
    expect(over.equipment).toEqual([...new Set([...stock.equipment, 'ar-cloth'])]);
    setShopOverrides([over]);
    expect(townShopStock(town, 0).materialId).toBe('slime-drop');
    const reward = starterTownQuests()[0]!.reward!;
    const cloth = EQUIPMENT_BY_ID['ar-cloth']!;
    expect(reward.power).toBe(cloth.price.power);
    expect(reward.count).toBe(cloth.price.materials);
    for (const job of JOBS) expect(canEquip(job.id, cloth)).toBe(true);
  });
});
