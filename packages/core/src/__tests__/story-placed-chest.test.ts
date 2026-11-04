/**
 * 宝箱・キラキラ・しらべる場所 (D-CHEST-001 §2)。
 * - 報酬は placedRewards 1 か所で正規化する (古い itemId/count も同じ形になる)
 * - 取れるかは placedItemOpen、しらべた結果は placedSearchOutcome で決める
 * - 検証: kind・報酬の実在と範囲・power 1〜50・hint・spot は flag 必須
 * - flag の無い宝箱・キラキラはフラグ数に入らない
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_FLAGS, MAX_PLACED_ITEMS, placedItemOpen, placedRewards, placedSearchOutcome, setStory, validateStory, worldRefs, StoryDataError,
  type PlacedItemDef, type ScenarioEvent,
} from '../index.js';

// 不正な値も入れたいので over は緩い型にする。
const chest = (over: Record<string, unknown> = {}) => ({ id: 'c1', mapId: 'cave-1', x: 1, y: 1, kind: 'chest', rewards: [{ item: 'herb', count: 2 }, { power: 3 }], ...over }) as PlacedItemDef;
const spot = (over: Record<string, unknown> = {}) => ({ id: 's1', mapId: 'cave-1', x: 2, y: 1, itemId: 'herb', count: 1, flag: 'got-s1', ...over }) as PlacedItemDef;

describe('placedRewards / placedItemOpen / placedSearchOutcome', () => {
  it('古い形は [{item,count}] に、rewards があればそちらを使う', () => {
    expect(placedRewards(spot())).toEqual([{ item: 'herb', count: 1 }]);
    expect(placedRewards(chest({ itemId: 'herb', count: 9 }))).toEqual([{ item: 'herb', count: 2 }, { power: 3 }]);
  });

  it('flag があればフラグで、無ければ openedSpots で取得済みを見る', () => {
    expect(placedItemOpen(chest(), [], [])).toBe(true);
    expect(placedItemOpen(chest(), [], ['c1'])).toBe(false);
    expect(placedItemOpen(spot(), [], ['s1'])).toBe(true);
    expect(placedItemOpen(spot(), ['got-s1'], [])).toBe(false);
    expect(placedItemOpen(chest({ requireFlags: ['ok'] }), [], [])).toBe(false);
  });

  it('宝箱は開封済み=empty・鍵=locked。hint つき spot の鍵も locked。それ以外は paid', () => {
    expect(placedSearchOutcome(chest(), [], [])).toBe('take');
    expect(placedSearchOutcome(chest(), [], ['c1'])).toBe('empty');
    expect(placedSearchOutcome(chest({ requireFlags: ['ok'] }), [], [])).toBe('locked');
    expect(placedSearchOutcome(spot({ requireFlags: ['ok'], hint: 'まだ早い' }), [], [])).toBe('locked');
    expect(placedSearchOutcome(spot({ requireFlags: ['ok'] }), [], [])).toBe('paid');
    expect(placedSearchOutcome(spot(), ['got-s1'], [])).toBe('paid');
    expect(placedSearchOutcome(chest({ kind: 'sparkle' }), [], ['c1'])).toBe('paid');
  });
});

describe('置きアイテムの検証 (kind / rewards / hint)', () => {
  afterEach(() => setStory(null));

  it('正しい宝箱・キラキラ・古い spot は通る', () => {
    expect(() => validateStory({ placedItems: [chest(), chest({ id: 'k1', x: 3, kind: 'sparkle', rewards: [{ equipment: 'wp-knife' }] }), spot()] })).not.toThrow();
  });

  it('kind・報酬・power・hint・spot の flag が不正なら落とす', () => {
    for (const bad of [
      chest({ kind: 'box' }),
      chest({ rewards: [] }),
      chest({ rewards: [{ power: 1 }, { power: 1 }, { power: 1 }, { power: 1 }] }),
      chest({ rewards: [{ item: 'nope', count: 1 }] }),
      chest({ rewards: [{ item: 'herb', count: 0 }] }),
      chest({ rewards: [{ equipment: 'nope' }] }),
      chest({ rewards: [{ power: 0 }] }),
      chest({ rewards: [{ power: 51 }] }),
      chest({ rewards: undefined }),
      chest({ hint: 'あ'.repeat(41) }),
      chest({ hint: '一行目\n二行目' }),
      spot({ flag: undefined }),
      chest({ flag: '' }),
    ]) expect(() => validateStory({ placedItems: [bad] }), JSON.stringify(bad)).toThrow(StoryDataError);
  });

  it('置きアイテムの上限は 400', () => {
    expect(MAX_PLACED_ITEMS).toBe(400);
  });

  it('flag なしの宝箱はフラグ数に入らない', () => {
    const events: ScenarioEvent[] = [{ id: 'e', title: 't', when: [], setFlags: Array.from({ length: MAX_FLAGS }, (_, i) => `s${i}`) }];
    expect(() => validateStory({ placedItems: [chest()] }, events)).not.toThrow();
    expect(() => validateStory({ placedItems: [chest({ flag: 'c1-open' })] }, events)).toThrow(StoryDataError);
  });

  it('参照検索は rewards の アイテムと装備を挙げる', () => {
    setStory({ placedItems: [chest({ rewards: [{ item: 'sky-dew', count: 1 }, { equipment: 'wp-knife' }] })] });
    expect(worldRefs('item').filter((r) => r.from === '置きアイテム「c1」').map((r) => r.id)).toEqual(['sky-dew']);
    expect(worldRefs('equipment').filter((r) => r.from === '置きアイテム「c1」').map((r) => r.id)).toEqual(['wp-knife']);
  });
});
