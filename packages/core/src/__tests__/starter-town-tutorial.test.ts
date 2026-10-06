import { afterEach, describe, expect, it } from 'vitest';
import {
  STARTER_TOWN_GUILD, starterTownQuests, starterTownScenario, starterTownNpcs, starterTownShop,
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
    // ギルドの素材依頼は既存3依頼のシナリオ連鎖には参加しない。
    const guildQuest = quests.find(q => q.id === 'futaba-tool-care')!;
    expect(guildQuest.requireFlags).toBeUndefined();
    expect(pendingScenario({ ...p, questsDone: [guildQuest.id] }).fired).toEqual([]);
    for (const [i, q] of quests.slice(0, 3).entries()) {
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

  it('導入の物語 (#692): 伝承は最初の依頼の冒頭、Blueskyちゃんは井戸近くのギルドで 3 依頼後に旅立ちを示す', () => {
    const quests = starterTownQuests();
    expect(quests[0]!.id).toBe('futaba-slimes');
    expect(quests[0]!.intro[0]).toBe('むかし、空は七羽の鳥に守られておった。鳥たちが眠ると、空は色を失う。七羽すべてを目覚めさせたとき、空に虹の橋がかかる……');
    const npcs = starterTownNpcs();
    const bluesky = npcs.find((n) => n.id === 'futaba-bluesky')!;
    expect(bluesky).toMatchObject({ name: 'Blueskyちゃん', spritePreset: 'bluesky' });
    expect(bluesky).toMatchObject({ x: STARTER_TOWN_GUILD.x, y: STARTER_TOWN_GUILD.y });
    expect(quests[2]!.done[2]).toBe('これで 旅の力は じゅうぶん。いどのそばのギルドの Blueskyちゃんが あなたを さがしてたよ。');
    expect(starterTownScenario().find((e) => e.id === 'futaba-after-wings')).toMatchObject({ notice: 'そらが いっしゅん、あかく ひかった。', effects: [{ kind: 'tint', color: 'red' }] });
    expect(npcLinesFor(bluesky, [], {})).toEqual(['おにいちゃんが、いなくなっちゃったの。そしたら、空の色も……']);
    expect(npcLinesFor(bluesky, ['futaba_herbs_done'], {})).toEqual(bluesky.lines);
    const departure = npcLinesFor(bluesky, ['futaba_slimes_done', 'futaba_herbs_done', 'futaba_wings_done'], {}).join('');
    expect(departure).toContain('みた？ いま 空が あかく ひかったの。');
    expect(departure).toContain('『あかい 鳥が めを さましかけている。ほむらの街へ むかってくれ。――空を、たのんだよ。』');
    expect(departure).toContain('ほむらの街');
    expect(npcs.find((n) => n.id === 'futaba-innkeeper-wife')!.lines[0]).toContain('Blueskyちゃんが みつけた たびびとだね');
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
