import { describe, it, expect } from 'vitest';
import { APP_VERSION, APP_VERSION_PATTERN } from './app-version';

describe('APP_VERSION', () => {
  it('は YYYY.MM.DD-N 形式 (リリース日 + 枝番) である', () => {
    // 形式崩れ (semver を書いてしまった等) を CI で検出する
    expect(APP_VERSION).toMatch(APP_VERSION_PATTERN);
  });

  it('月・日はゼロ詰め 2 桁、枝番は 1 以上', () => {
    const m = APP_VERSION.match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d+)$/);
    expect(m).not.toBeNull();
    const [, , mm, dd, n] = m!;
    expect(Number(mm)).toBeGreaterThanOrEqual(1);
    expect(Number(mm)).toBeLessThanOrEqual(12);
    expect(Number(dd)).toBeGreaterThanOrEqual(1);
    expect(Number(dd)).toBeLessThanOrEqual(31);
    expect(Number(n)).toBeGreaterThanOrEqual(1);
  });
});

describe('APP_VERSION_PATTERN', () => {
  it('正しい日付 + 枝番を受理する', () => {
    for (const v of ['2026.06.14-1', '2026.01.01-1', '2026.12.31-2', '2026.10.09-12']) {
      expect(APP_VERSION_PATTERN.test(v)).toBe(true);
    }
  });
  it('不正な月/日/枝番/ゼロ詰め無しを弾く', () => {
    for (const v of [
      '2026.13.45-0', // 月13・日45・枝番0
      '2026.13.01-1', // 月13
      '2026.00.10-1', // 月00
      '2026.06.32-1', // 日32
      '2026.6.14-1', //  月ゼロ詰めなし
      '2026.06.14-0', // 枝番0
      '2026.06.14', //   枝番なし
      '0.1.0', //        semver 誤記
      'v2026.06.14-1', // v 付き
    ]) {
      expect(APP_VERSION_PATTERN.test(v)).toBe(false);
    }
  });
});
