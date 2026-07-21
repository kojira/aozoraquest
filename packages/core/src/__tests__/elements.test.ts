import { describe, it, expect } from 'vitest';
import { elementMultiplier, ELEMENT_MULT, type Element } from '../elements.js';

describe('elementMultiplier (属性相性 #452)', () => {
  it('無属性 (null/undefined) が絡めば常に等倍', () => {
    expect(elementMultiplier(null, 'fire')).toBe(1);
    expect(elementMultiplier('fire', null)).toBe(1);
    expect(elementMultiplier(undefined, undefined)).toBe(1);
  });

  it('輪 地→水→火→風→地 で「強い」側が有利 (×strong)', () => {
    expect(elementMultiplier('earth', 'water')).toBe(ELEMENT_MULT.strong);
    expect(elementMultiplier('water', 'fire')).toBe(ELEMENT_MULT.strong);
    expect(elementMultiplier('fire', 'wind')).toBe(ELEMENT_MULT.strong);
    expect(elementMultiplier('wind', 'earth')).toBe(ELEMENT_MULT.strong);
  });

  it('逆側は不利 (×weak)', () => {
    expect(elementMultiplier('water', 'earth')).toBe(ELEMENT_MULT.weak);
    expect(elementMultiplier('fire', 'water')).toBe(ELEMENT_MULT.weak);
    expect(elementMultiplier('wind', 'fire')).toBe(ELEMENT_MULT.weak);
    expect(elementMultiplier('earth', 'wind')).toBe(ELEMENT_MULT.weak);
  });

  it('正面以外 (地↔火 / 水↔風) は中立', () => {
    expect(elementMultiplier('earth', 'fire')).toBe(1);
    expect(elementMultiplier('fire', 'earth')).toBe(1);
    expect(elementMultiplier('water', 'wind')).toBe(1);
    expect(elementMultiplier('wind', 'water')).toBe(1);
  });

  it('空 (void) は攻撃も被弾も 1.2', () => {
    for (const e of ['earth', 'water', 'fire', 'wind', 'void'] as Element[]) {
      expect(elementMultiplier('void', e)).toBe(ELEMENT_MULT.voidMult); // 空で殴る
      expect(elementMultiplier(e, 'void')).toBe(ELEMENT_MULT.voidMult); // 空を殴る
    }
  });

  it('相性は対称 (X が Y に有利なら Y は X に不利 = 輪の一貫性)', () => {
    const els: Element[] = ['earth', 'water', 'fire', 'wind'];
    for (const a of els) for (const b of els) {
      if (a === b) continue;
      const ab = elementMultiplier(a, b);
      const ba = elementMultiplier(b, a);
      if (ab === ELEMENT_MULT.strong) expect(ba).toBe(ELEMENT_MULT.weak);
      if (ab === ELEMENT_MULT.weak) expect(ba).toBe(ELEMENT_MULT.strong);
    }
  });
});
