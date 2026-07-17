import { describe, expect, test } from 'vitest';
import { resolveGear } from './gear';
import type { CraftedPiece } from './crafting';

const pieces: CraftedPiece[] = [
  { rkey: 'c-1', itemId: 'wp-bard-mid', level: 3, at: 't1' }, // 竪琴 (吟遊詩人専用・weapon)
  { rkey: 'c-2', itemId: 'ar-fortune', level: 0, at: 't2' }, // しあわせの衣 (armor)
  { rkey: 'c-3', itemId: 'ch-life', level: 1, at: 't3' }, // ペンダント (charm)
  { rkey: 'c-4', itemId: 'wp-ninja-mid', level: 5, at: 't4' }, // 忍者刀 (忍者専用)
];

describe('resolveGear (gear/self の rkey 参照解決)', () => {
  test('有効な参照はスロットへ解決され、強化値が引き継がれる', () => {
    const r = resolveGear({ weapon: 'c-1', armor: 'c-2', charm: 'c-3' }, pieces, 'bard');
    expect(r.selection.weapon).toEqual({ id: 'wp-bard-mid', level: 3 });
    expect(r.selection.armor).toEqual({ id: 'ar-fortune', level: 0 });
    expect(r.selection.charm).toEqual({ id: 'ch-life', level: 1 });
  });

  test('無効な参照は黙って外れる: 不存在・スロット不一致・装備不可・未診断', () => {
    // 不存在 rkey (合成で燃やした後など)
    expect(resolveGear({ weapon: 'c-gone' }, pieces, 'bard').selection.weapon).toBeUndefined();
    // スロット不一致 (weapon 枠に charm の個体)
    expect(resolveGear({ weapon: 'c-3' }, pieces, 'bard').selection.weapon).toBeUndefined();
    // 装備不可 (吟遊詩人が忍者刀 = 転職後の自然失効)
    expect(resolveGear({ weapon: 'c-4' }, pieces, 'bard').selection.weapon).toBeUndefined();
    // 未診断 (archetype null)
    expect(resolveGear({ weapon: 'c-1' }, pieces, null).selection).toEqual({});
  });
});
