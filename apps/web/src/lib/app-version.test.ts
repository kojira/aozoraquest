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
