import { describe, it, expect } from 'vitest';
import { formatDateTime } from './format-datetime';

describe('formatDateTime', () => {
  it('formats an ISO string to YYYY/MM/DD HH:MM:SS in local time', () => {
    // 値はローカルタイムゾーン依存なので、ローカルで作った Date の ISO を渡して往復で検証する
    const d = new Date(2026, 5, 14, 9, 5, 3); // 2026-06-14 09:05:03 local
    expect(formatDateTime(d.toISOString())).toBe('2026/06/14 09:05:03');
  });

  it('zero-pads month / day / hour / minute / second', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5); // 2026-01-02 03:04:05 local
    expect(formatDateTime(d.toISOString())).toBe('2026/01/02 03:04:05');
  });

  it('keeps seconds (full precision, never truncated)', () => {
    const d = new Date(2026, 11, 31, 23, 59, 59);
    expect(formatDateTime(d.toISOString())).toMatch(/^2026\/12\/31 23:59:59$/);
  });

  it('returns empty string for null / undefined / invalid input', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not-a-date')).toBe('');
  });
});
