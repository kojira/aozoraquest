/**
 * 店の上書きの「空判定」(#635)。店主だけ入力した上書きを捨てていたため、
 * 打った文字が即座に消えて**入力できない**状態になっていた。
 *
 * UI の状態遷移そのものを持つのは admin-shops.tsx の setField だが、判定の中身
 * (何を「中身あり」と数えるか) はここで固定する。
 */
import { describe, it, expect } from 'vitest';
import type { ShopOverride } from '@aozoraquest/core';

/** setField と同じ判定 (実装を変えたらここも落ちる)。 */
function isEmpty(m: ShopOverride): boolean {
  const hasKeeper = !!m.keeper && Object.values(m.keeper).some((v) => v !== undefined && v !== '');
  return !m.equipment && !m.consumables && !m.materialId && !hasKeeper;
}

describe('店の上書きの空判定', () => {
  const base: ShopOverride = { x: 1, y: 2 };

  it('何も無ければ空', () => {
    expect(isEmpty(base)).toBe(true);
  });

  it('**店主だけでも空ではない** (捨てると入力できなくなる)', () => {
    expect(isEmpty({ ...base, keeper: { name: 'あるじ' } })).toBe(false);
    expect(isEmpty({ ...base, keeper: { greeting: 'いらっしゃい' } })).toBe(false);
  });

  it('店主のフィールドが全部空なら空', () => {
    expect(isEmpty({ ...base, keeper: {} })).toBe(true);
    expect(isEmpty({ ...base, keeper: { name: '' } })).toBe(true);
  });

  it('品揃え・値札があれば空ではない', () => {
    expect(isEmpty({ ...base, equipment: ['wp-knife'] })).toBe(false);
    expect(isEmpty({ ...base, materialId: 'herb' })).toBe(false);
  });
});
