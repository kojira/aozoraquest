import { describe, expect, test } from 'vitest';
import { resolveGear } from './gear';
import type { CraftedPiece } from './crafting';

const pieces: CraftedPiece[] = [
  { rkey: 'c-1', itemId: 'wp-bard-mid', level: 3, at: 't1' }, // 竪琴 (吟遊詩人専用・weapon)
  { rkey: 'c-2', itemId: 'ar-fortune', level: 0, at: 't2' }, // しあわせの衣 (armor)
  { rkey: 'c-3', itemId: 'ch-life', level: 1, at: 't3' }, // ペンダント (charm)
  { rkey: 'c-4', itemId: 'wp-ninja-mid', level: 5, at: 't4' }, // 忍者刀 (忍者専用)
];

describe('loadGearRefs / saveGearRefs (レコード往復)', () => {
  test('保存した参照がそのまま読める。余計なキー・非文字列は無視', async () => {
    const { loadGearRefs, saveGearRefs } = await import('./gear');
    let stored: any = null;
    const agent = {
      assertDid: 'did:test',
      com: { atproto: { repo: {
        putRecord: async (a: any) => { stored = a.record; return { data: {} }; },
        getRecord: async () => ({ data: { value: { ...stored, junk: 42, armor: 7 } } }),
      } } },
    } as any;
    await saveGearRefs(agent, { weapon: 'c-1', charm: 'c-3' });
    expect(stored.weapon).toBe('c-1');
    expect(stored.armor).toBeUndefined(); // はずした枠はキーごと消える (全置換)
    const refs = await loadGearRefs(agent, 'did:test');
    expect(refs).toEqual({ weapon: 'c-1', charm: 'c-3' }); // armor:7 (非文字列) と junk は無視
  });
});

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
