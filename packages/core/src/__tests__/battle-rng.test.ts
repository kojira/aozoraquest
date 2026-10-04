import { describe, it, expect } from 'vitest';
import { createRng, turnRng } from '../battle.js';

describe('createRng / turnRng', () => {
  it('同じ seed は同じ列を返す (決定的)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it('異なる seed は異なる列', () => {
    const a = createRng(1)();
    const b = createRng(2)();
    expect(a).not.toBe(b);
  });
  it('値域は [0,1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('turnRng はターン毎に独立だが決定的', () => {
    expect(turnRng(5, 1)()).toBe(turnRng(5, 1)());
    expect(turnRng(5, 1)()).not.toBe(turnRng(5, 2)());
  });
});
