import { describe, expect, test } from 'vitest';
import { DEFAULT_QUEST_TEMPLATES, generateDailyQuests, levelFromXp } from '../quest.js';
import type { StatVector } from '../types.js';

describe('DEFAULT_QUEST_TEMPLATES', () => {
  test('45 件ある', () => {
    expect(DEFAULT_QUEST_TEMPLATES.length).toBe(45);
  });

  test('全 ID がユニーク', () => {
    const ids = DEFAULT_QUEST_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('growth が 30, maintenance 5, restraint 10', () => {
    const counts = { growth: 0, maintenance: 0, restraint: 0 };
    for (const t of DEFAULT_QUEST_TEMPLATES) counts[t.type]++;
    expect(counts).toEqual({ growth: 30, maintenance: 5, restraint: 10 });
  });

  test('restraint は必ず forbiddenActionTypes を持つ', () => {
    const r = DEFAULT_QUEST_TEMPLATES.filter((t) => t.type === 'restraint');
    for (const t of r) {
      expect(t.forbiddenActionTypes).toBeDefined();
      expect(t.forbiddenActionTypes!.length).toBeGreaterThan(0);
    }
  });

  test('5 軸それぞれに growth テンプレがある', () => {
    for (const s of ['atk', 'def', 'agi', 'int', 'luk'] as const) {
      const count = DEFAULT_QUEST_TEMPLATES.filter((t) => t.type === 'growth' && t.targetStat === s).length;
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });

  test('requiredCountFn は LV 1 で非負、LV 50 では LV 1 以上', () => {
    for (const t of DEFAULT_QUEST_TEMPLATES) {
      const at1 = t.requiredCountFn(1);
      const at50 = t.requiredCountFn(50);
      expect(at1).toBeGreaterThanOrEqual(0);
      expect(at50).toBeGreaterThanOrEqual(at1);
    }
  });
});

describe('generateDailyQuests', () => {
  const stats = (atk: number, def: number, agi: number, int: number, luk: number): StatVector => ({ atk, def, agi, int, luk });

  test('成長 2 + 節制 1 を生成 (ギャップがあれば)', () => {
    const quests = generateDailyQuests({
      userDid: 'did:plc:a',
      dateStr: '2026-04-21',
      level: 5,
      currentStats: stats(30, 60, 50, 80, 40), // int 過剰、atk 不足
      targetStats: stats(60, 60, 60, 60, 60),
      recentTemplateIds: [],
    });
    // growth 2 + restraint 1
    expect(quests.length).toBe(3);
    expect(quests.filter((q) => q.type === 'growth').length).toBeGreaterThanOrEqual(1);
    expect(quests.filter((q) => q.type === 'restraint').length).toBeLessThanOrEqual(1);
  });

  test('同じ入力なら決定的', () => {
    const input = {
      userDid: 'did:plc:a',
      dateStr: '2026-04-21',
      level: 3,
      currentStats: stats(40, 50, 50, 60, 50),
      targetStats: stats(60, 60, 60, 60, 60),
      recentTemplateIds: [] as string[],
    };
    const a = generateDailyQuests(input);
    const b = generateDailyQuests(input);
    expect(a.map((q) => q.templateId)).toEqual(b.map((q) => q.templateId));
  });

  test('recentTemplateIds に入っているテンプレは避けられる', () => {
    const input = {
      userDid: 'did:plc:a',
      dateStr: '2026-04-21',
      level: 3,
      currentStats: stats(30, 50, 50, 50, 50),
      targetStats: stats(80, 50, 50, 50, 50), // atk 狙い撃ち
      recentTemplateIds: ['atk_opinion_post'],
    };
    const quests = generateDailyQuests(input);
    expect(quests.some((q) => q.templateId === 'atk_opinion_post')).toBe(false);
  });
});

describe('levelFromXp', () => {
  test('0 XP は LV1', () => {
    expect(levelFromXp(0)).toBe(1);
  });

  test('100 XP は LV2', () => {
    expect(levelFromXp(100)).toBe(2);
  });

  test('150000 XP で LV50', () => {
    expect(levelFromXp(150_000)).toBe(50);
  });
});
