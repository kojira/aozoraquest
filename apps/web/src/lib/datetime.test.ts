import { describe, it, expect } from 'vitest';
import {
  parseLocal,
  formatLocal,
  formatDisplay,
  daysInMonth,
  minuteOptions,
  isoToLocalInput,
} from './datetime';

describe('parseLocal', () => {
  it('parses a valid local datetime string', () => {
    expect(parseLocal('2026-06-20T23:59')).toEqual({ y: 2026, m: 6, d: 20, hh: 23, mm: 59 });
  });

  it('ignores trailing seconds', () => {
    expect(parseLocal('2026-06-20T08:05:30')).toEqual({ y: 2026, m: 6, d: 20, hh: 8, mm: 5 });
  });

  it('returns null for empty / malformed input', () => {
    expect(parseLocal('')).toBeNull();
    expect(parseLocal('2026-06-20')).toBeNull();
    expect(parseLocal('not-a-date')).toBeNull();
  });

  it('rejects trailing garbage and TZ-suffixed ISO (anchored)', () => {
    expect(parseLocal('2026-06-20T23:59GARBAGE')).toBeNull();
    // TZ 付きはローカル誤解釈を避けるため null
    expect(parseLocal('2026-06-20T23:59:00Z')).toBeNull();
    expect(parseLocal('2026-06-20T23:59+09:00')).toBeNull();
  });

  it('rejects out-of-range month / hour / minute', () => {
    expect(parseLocal('2026-13-01T00:00')).toBeNull();
    expect(parseLocal('2026-06-20T24:00')).toBeNull();
    expect(parseLocal('2026-06-20T23:60')).toBeNull();
  });

  it('rejects non-existent calendar dates', () => {
    expect(parseLocal('2026-02-31T12:00')).toBeNull();
    expect(parseLocal('2026-04-31T12:00')).toBeNull();
  });

  it('accepts a valid leap day', () => {
    expect(parseLocal('2028-02-29T12:00')).toEqual({ y: 2028, m: 2, d: 29, hh: 12, mm: 0 });
  });
});

describe('formatLocal', () => {
  it('zero-pads month / day / hour / minute', () => {
    expect(formatLocal(2026, 6, 7, 9, 5)).toBe('2026-06-07T09:05');
  });

  it('round-trips through parseLocal', () => {
    const s = '2026-12-31T00:00';
    const p = parseLocal(s)!;
    expect(formatLocal(p.y, p.m, p.d, p.hh, p.mm)).toBe(s);
  });
});

describe('formatDisplay', () => {
  it('renders the Japanese weekday and zero-padded time', () => {
    // 2026-06-20 は土曜日
    expect(formatDisplay({ y: 2026, m: 6, d: 20, hh: 23, mm: 59 })).toBe('2026年6月20日 (土) 23:59');
  });
});

describe('isoToLocalInput', () => {
  it('round-trips a picker value through ISO and back', () => {
    // ローカル文字列 → ISO (board が保存する形) → ローカル文字列 が一致する
    const local = '2026-06-20T23:59';
    const iso = new Date(local).toISOString();
    expect(isoToLocalInput(iso)).toBe(local);
  });

  it('returns empty string for an invalid ISO', () => {
    expect(isoToLocalInput('garbage')).toBe('');
  });
});

describe('daysInMonth', () => {
  it('returns the correct length for each month', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29); // 閏年
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe('minuteOptions', () => {
  it('returns 5-minute increments by default', () => {
    expect(minuteOptions()).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it('inserts an off-grid current value in order', () => {
    expect(minuteOptions(59)).toContain(59);
    const opts = minuteOptions(59);
    expect(opts[opts.length - 1]).toBe(59);
    expect([...opts].sort((a, b) => a - b)).toEqual(opts);
  });

  it('does not duplicate an on-grid current value', () => {
    expect(minuteOptions(30)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });
});
