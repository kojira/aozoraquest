import { describe, expect, test } from 'vitest';
import { countTrialsToday, isTrialCapped, jstDayKey, TRIAL_DAILY_LIMIT, trialsRemaining } from './trial-limit';

describe('jstDayKey', () => {
  test('JST 暦日に変換する (UTC+9)', () => {
    // 2026-07-18 15:00 UTC = 2026-07-19 00:00 JST → 19 日
    expect(jstDayKey('2026-07-18T15:00:00.000Z')).toBe('2026-07-19');
    // 2026-07-18 14:59 UTC = 2026-07-18 23:59 JST → まだ 18 日
    expect(jstDayKey('2026-07-18T14:59:00.000Z')).toBe('2026-07-18');
  });
  test('不正な時刻は空文字', () => {
    expect(jstDayKey('not-a-date')).toBe('');
  });
});

describe('countTrialsToday', () => {
  const now = '2026-07-18T12:00:00.000Z'; // JST 2026-07-18 21:00

  test('今日の試練だけ数える (別日・野外遭遇は除外)', () => {
    const records = [
      { at: '2026-07-18T11:00:00.000Z', source: 'trial' }, // 今日
      { at: '2026-07-18T02:00:00.000Z', source: 'trial' }, // 今日 (JST 11:00)
      { at: '2026-07-17T12:00:00.000Z', source: 'trial' }, // 昨日
      { at: '2026-07-18T11:30:00.000Z', source: 'world' }, // 野外 = 除外
    ];
    expect(countTrialsToday(records, now)).toBe(2);
  });

  test('source 欠落は試練として数える (旧レコード互換)', () => {
    const records = [{ at: '2026-07-18T11:00:00.000Z' }];
    expect(countTrialsToday(records, now)).toBe(1);
  });

  test('JST 日付境界をまたぐ: 前日 15:00 UTC 以降は今日扱い', () => {
    // now = JST 07-18 21:00。07-17 15:00 UTC = JST 07-18 00:00 = 今日の始まり
    const records = [
      { at: '2026-07-17T15:00:00.000Z', source: 'trial' }, // JST 07-18 00:00 = 今日
      { at: '2026-07-17T14:59:00.000Z', source: 'trial' }, // JST 07-17 23:59 = 昨日
    ];
    expect(countTrialsToday(records, now)).toBe(1);
  });
});

describe('trialsRemaining', () => {
  test('上限からの残り。0 未満にしない', () => {
    expect(trialsRemaining(0)).toBe(TRIAL_DAILY_LIMIT);
    expect(trialsRemaining(TRIAL_DAILY_LIMIT)).toBe(0);
    expect(trialsRemaining(TRIAL_DAILY_LIMIT + 3)).toBe(0);
  });
});

describe('isTrialCapped', () => {
  test('未取得 (null) は未達扱い / 上限で true', () => {
    expect(isTrialCapped(null)).toBe(false);
    expect(isTrialCapped(0)).toBe(false);
    expect(isTrialCapped(TRIAL_DAILY_LIMIT - 1)).toBe(false);
    expect(isTrialCapped(TRIAL_DAILY_LIMIT)).toBe(true);
    expect(isTrialCapped(TRIAL_DAILY_LIMIT + 5)).toBe(true);
  });
});
