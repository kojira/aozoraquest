import { describe, it, expect } from 'vitest';
import { displayWidth } from './text-width';

describe('displayWidth', () => {
  it('counts ASCII / Latin-1 as width 1', () => {
    expect(displayWidth('')).toBe(0);
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('bsky.app')).toBe(8);
    expect(displayWidth('Brendan Nyhan')).toBe(13);
  });

  it('counts full-width (CJK / kana) as width 2', () => {
    expect(displayWidth('あ')).toBe(2);
    expect(displayWidth('忍者')).toBe(4);
    expect(displayWidth('すいばり')).toBe(8);
  });

  it('mixes half and full width', () => {
    // 'A' (1) + 'あ' (2) + '1' (1)
    expect(displayWidth('Aあ1')).toBe(4);
  });

  it('counts an emoji (surrogate pair) as a single width-2 unit, not 4', () => {
    expect(displayWidth('😀')).toBe(2);
    expect(displayWidth('😀😀😀')).toBe(6);
  });

  it('treats half-width kana as width 2 (documented over-estimate, safe side)', () => {
    expect(displayWidth('ｱｲｳ')).toBe(6);
  });

  it('crosses the handle-hide threshold (18) for a long display name', () => {
    // 9 full-width chars = width 18 (= threshold, still shown)
    expect(displayWidth('あいうえおかきくけ')).toBe(18);
    // 10 full-width chars = width 20 (> threshold, handle hidden)
    expect(displayWidth('あいうえおかきくけこ')).toBe(20);
  });
});
