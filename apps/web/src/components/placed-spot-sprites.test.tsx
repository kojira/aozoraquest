// @vitest-environment jsdom
/**
 * 宝箱・キラキラの描画 (D-CHEST-001 §5)。
 * - 宝箱は条件のフラグがそろったら、未開封=閉じた・開封済み=開いた。そろわなければ描かない
 * - キラキラは取れる間だけ 2 コマで光り、取ったら消える。reduced-motion では 1 コマ目で止める
 * - spot は描かない
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { setStory, type PlacedItemDef } from '@aozoraquest/core';
import { placedSpotSprites } from './placed-spot-sprites';

const CHEST: PlacedItemDef = { id: 'c1', mapId: 'v', x: 5, y: 5, kind: 'chest', rewards: [{ power: 3 }] };
const LOCKED: PlacedItemDef = { id: 'c2', mapId: 'v', x: 6, y: 5, kind: 'chest', rewards: [{ power: 3 }], requireFlags: ['key'] };
const SPARK: PlacedItemDef = { id: 'k1', mapId: 'v', x: 7, y: 5, kind: 'sparkle', rewards: [{ item: 'herb', count: 1 }] };
const SPOT: PlacedItemDef = { id: 's1', mapId: 'v', x: 8, y: 5, itemId: 'herb', count: 1, flag: 'got-s1' };
const setReduced = (reduced: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
const draw = (opened: string[], flags: string[] = []) => render(<svg>{placedSpotSprites({ mapId: 'v', inside: true, at: { x: 6, y: 5 }, scrollPadding: 0, flags, opened })}</svg>).container;
const arts = (c: HTMLElement) => [...c.querySelectorAll('[data-placed]')].map((e) => `${e.getAttribute('data-placed')}:${e.getAttribute('data-art')}`);

describe('placedSpotSprites', () => {
  beforeEach(() => { setStory({ placedItems: [CHEST, LOCKED, SPARK, SPOT] }); setReduced(false); });
  afterEach(() => { setStory(null); vi.unstubAllGlobals(); });

  it('閉じた宝箱・キラキラを描き、鍵の宝箱と spot は描かない', () => {
    expect(arts(draw([]))).toEqual(['c1:chest-closed', 'k1:sparkle']);
  });

  it('開けた宝箱は開いた絵に、取ったキラキラは消える。条件がそろえば鍵の宝箱も出る', () => {
    expect(arts(draw(['c1', 'k1'], ['key']))).toEqual(['c1:chest-open', 'c2:chest-closed']);
  });

  it('キラキラは 2 コマを交互に出し、reduced-motion では 1 コマ目だけで止める', () => {
    const spark = draw([]).querySelector('[data-placed="k1"]')!;
    expect([...spark.querySelectorAll('.placed-sparkle-frame')].map((g) => g.getAttribute('data-frame'))).toEqual(['0', '1']);
    setReduced(true);
    const still = draw([]).querySelector('[data-placed="k1"]')!;
    expect(still.querySelectorAll('.placed-sparkle-frame')).toHaveLength(0);
    expect(still.querySelector('rect')).not.toBeNull();
  });
});
