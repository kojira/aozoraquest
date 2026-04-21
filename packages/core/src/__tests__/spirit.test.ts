import { describe, expect, test } from 'vitest';
import { pickSpiritLine } from '../spirit.js';

describe('pickSpiritLine', () => {
  test('{userName} を含むテンプレが選ばれたときはちゃんと展開される', () => {
    // プールが大きいので、どれか一つは {userName} を含むテンプレになる日を探す
    let expanded: string | null = null;
    for (let d = 1; d <= 30; d++) {
      const line = pickSpiritLine('greeting.morning', {
        userName: 'ことりら',
        userDid: 'did:plc:test',
        date: `2026-04-${String(d).padStart(2, '0')}`,
      });
      if (line && line.includes('ことりら')) {
        expanded = line;
        break;
      }
    }
    expect(expanded).not.toBeNull();
    expect(expanded!).not.toMatch(/\{userName\}/);
  });

  test('返り値にはいかなる未展開プレースホルダも残らない (提供済み変数)', () => {
    // すべての変数を与えれば、返り値に {xxx} は残らないはず
    for (const s of ['greeting.morning', 'quest.complete', 'levelup'] as const) {
      const line = pickSpiritLine(s, {
        userName: 'テスト',
        userDid: 'did:plc:t',
        date: '2026-04-21',
        levelNum: 5,
        streakDays: 30,
        partnerName: 'pp',
        statName: 'atk',
        targetJob: '職人',
      });
      expect(line).not.toBeNull();
      expect(line!).not.toMatch(/\{(userName|levelNum|streakDays|partnerName|statName|targetJob)\}/);
    }
  });

  test('deterministic for same seed', () => {
    const a = pickSpiritLine('quest.complete', { userName: 'x', userDid: 'did:plc:a', date: '2026-04-21' });
    const b = pickSpiritLine('quest.complete', { userName: 'x', userDid: 'did:plc:a', date: '2026-04-21' });
    expect(a).toBe(b);
  });

  test('differs across days', () => {
    const results = new Set<string>();
    for (const d of ['2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24']) {
      const line = pickSpiritLine('quest.complete', { userName: 'x', userDid: 'did:plc:a', date: d });
      if (line) results.add(line);
    }
    // 4 日分でちゃんと複数バリエーションが出る (テンプレが 3 個以上の場合)
    expect(results.size).toBeGreaterThan(1);
  });

  test('unknown situation → null', () => {
    expect(pickSpiritLine('nonexistent' as never, { userName: 'x', userDid: 'did:plc:a' })).toBeNull();
  });
});

describe('SPIRIT_TEMPLATES 量と網羅', () => {
  test('15 situation すべてに 20 件以上ある', async () => {
    const { SPIRIT_TEMPLATES } = await import('../spirit.js');
    const situations = [
      'greeting.morning', 'greeting.daytime', 'greeting.night',
      'quest.new', 'quest.progress', 'quest.complete', 'quest.failed',
      'levelup', 'stat.shift.significant', 'job.match.increase',
      'job.eligible', 'streak.milestone', 'companion.added',
      'empty.timeline', 'first.time',
    ] as const;
    for (const s of situations) {
      const pool = SPIRIT_TEMPLATES[s];
      expect(pool?.length ?? 0).toBeGreaterThanOrEqual(20);
    }
  });

  test('全セリフ合計 500 件以上', async () => {
    const { SPIRIT_TEMPLATES } = await import('../spirit.js');
    const total = Object.values(SPIRIT_TEMPLATES).reduce((s, pool) => s + (pool?.length ?? 0), 0);
    expect(total).toBeGreaterThanOrEqual(500);
  });
});
