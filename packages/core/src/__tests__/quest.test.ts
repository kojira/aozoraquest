import { describe, expect, test } from 'vitest';
import { DEFAULT_QUEST_TEMPLATES, JOB_XP_CURVE, PLAYER_XP_CURVE, generateDailyQuests, jobLevelFromXp, jobXpToNextLevel, levelFromXp, playerLevelFromXp, playerXpToNextLevel } from '../quest.js';
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

  test('目標ジョブを切り替えると育成軸が変わる', () => {
    // 同じ現在ステータスに対して、目標を「攻極振り」と「知極振り」で生成。
    // 攻を目標にしたら atk 系クエストが出て、知を目標にしたら int 系クエストが出るはず。
    const common = {
      userDid: 'did:plc:target-switch',
      dateStr: '2026-04-21',
      level: 1,
      currentStats: stats(30, 30, 30, 30, 30), // 平坦
      recentTemplateIds: [] as string[],
    };
    const atkFocused = generateDailyQuests({
      ...common,
      targetStats: stats(80, 10, 5, 5, 0),
    });
    const intFocused = generateDailyQuests({
      ...common,
      targetStats: stats(5, 10, 5, 80, 0),
    });
    // それぞれ成長クエストの targetStat を見れば、最大ギャップ軸に沿っていることが分かる
    const atkGrowthStats = atkFocused.filter((q) => q.type === 'growth').map((q) => q.targetStat);
    const intGrowthStats = intFocused.filter((q) => q.type === 'growth').map((q) => q.targetStat);
    expect(atkGrowthStats).toContain('atk');
    expect(intGrowthStats).toContain('int');
    // 2 つのクエスト集合が完全一致しないこと (= 目標が効いている)
    expect(atkFocused.map((q) => q.templateId)).not.toEqual(intFocused.map((q) => q.templateId));
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

describe('jobLevelFromXp', () => {
  test('0 XP は LV1', () => {
    expect(jobLevelFromXp(0)).toBe(1);
  });

  test('LV2 閾値 (30 XP) ぴったりで LV2', () => {
    expect(jobLevelFromXp(30)).toBe(2);
  });

  test('LV2 閾値未満は LV1', () => {
    expect(jobLevelFromXp(29)).toBe(1);
  });

  test('LV50 閾値付近で LV50', () => {
    const lv50 = JOB_XP_CURVE[49]![1];
    expect(jobLevelFromXp(lv50)).toBe(50);
  });

  test('LV50 を超えても LV50 (上限)', () => {
    expect(jobLevelFromXp(1_000_000)).toBe(50);
  });

  test('曲線は LV1-50 を全て含み、単調増加', () => {
    expect(JOB_XP_CURVE.length).toBe(50);
    expect(JOB_XP_CURVE[0]).toEqual([1, 0]);
    for (let i = 1; i < JOB_XP_CURVE.length; i++) {
      const prev = JOB_XP_CURVE[i - 1]![1];
      const cur = JOB_XP_CURVE[i]![1];
      expect(cur).toBeGreaterThan(prev);
    }
  });
});

describe('playerLevelFromXp', () => {
  test('0 XP は LV1', () => {
    expect(playerLevelFromXp(0)).toBe(1);
  });

  test('LV2 閾値 (60 XP) ぴったりで LV2', () => {
    expect(playerLevelFromXp(60)).toBe(2);
  });

  test('上限は LV99', () => {
    expect(playerLevelFromXp(10_000_000)).toBe(99);
  });

  test('曲線は LV1-99 を含み単調増加', () => {
    expect(PLAYER_XP_CURVE.length).toBe(99);
    expect(PLAYER_XP_CURVE[0]).toEqual([1, 0]);
    for (let i = 1; i < PLAYER_XP_CURVE.length; i++) {
      expect(PLAYER_XP_CURVE[i]![1]).toBeGreaterThan(PLAYER_XP_CURVE[i - 1]![1]);
    }
  });

  test('同じ XP なら Player LV は Job LV 以下 (Player の方が緩やか)', () => {
    for (const xp of [0, 100, 1000, 5000, 20000, 44000]) {
      expect(playerLevelFromXp(xp)).toBeLessThanOrEqual(jobLevelFromXp(xp));
    }
  });
});

describe('playerXpToNextLevel', () => {
  test('0 XP は LV1、next=60', () => {
    expect(playerXpToNextLevel(0)).toEqual({ level: 1, current: 0, next: 60 });
  });

  test('LV99 到達後は next=0', () => {
    const lv99 = PLAYER_XP_CURVE[98]![1];
    expect(playerXpToNextLevel(lv99)).toMatchObject({ level: 99, next: 0 });
  });
});

describe('jobXpToNextLevel', () => {
  test('0 XP は LV1、current=0、next=30', () => {
    expect(jobXpToNextLevel(0)).toEqual({ level: 1, current: 0, next: 30 });
  });

  test('LV2 到達直後は current=0', () => {
    const lv2 = JOB_XP_CURVE[1]![1];
    const lv3 = JOB_XP_CURVE[2]![1];
    expect(jobXpToNextLevel(lv2)).toEqual({ level: 2, current: 0, next: lv3 - lv2 });
  });

  test('LV50 到達後は next=0', () => {
    const lv50 = JOB_XP_CURVE[49]![1];
    expect(jobXpToNextLevel(lv50)).toMatchObject({ level: 50, next: 0 });
  });

  test('LV 中間では current+curThreshold = xp', () => {
    const xp = 500;
    const { level, current } = jobXpToNextLevel(xp);
    const curThreshold = JOB_XP_CURVE.find((e) => e[0] === level)![1];
    expect(current + curThreshold).toBe(xp);
  });
});
