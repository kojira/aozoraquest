/**
 * しらべた結果の文言 (D-CHEST-001 §6)。宝箱・キラキラ・spot・空・鍵。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setStory } from '@aozoraquest/core';
import { placedSearchFreeAt, placedStateText, placedTakenText, searchMenuLabel } from './placed-search-text';

describe('placedTakenText', () => {
  it('宝箱: 1 つなら「○○を手に入れた！」、複数なら「○○と △△を手に入れた！」', () => {
    expect(placedTakenText({ kind: 'chest', rewards: [{ item: 'herb', count: 2 }] })).toBe('宝箱を開けた！ やくそう×2を手に入れた！');
    expect(placedTakenText({ kind: 'chest', rewards: [{ item: 'herb', count: 2 }, { power: 3 }] })).toBe('宝箱を開けた！ やくそう×2と あおぞらパワー3を手に入れた！');
  });

  it('装備は「（そうびで確認）」、パワーだけなら「あおぞらパワーを N 手に入れた！」', () => {
    expect(placedTakenText({ kind: 'chest', rewards: [{ equipment: 'wp-knife' }] })).toBe('宝箱を開けた！ ナイフを手に入れた！（そうびで確認）');
    expect(placedTakenText({ kind: 'chest', rewards: [{ power: 3 }] })).toBe('宝箱を開けた！ あおぞらパワーを 3 手に入れた！');
  });

  it('キラキラ: 「キラキラ光る場所を調べた！ ○○を手に入れた！」', () => {
    expect(placedTakenText({ kind: 'sparkle', rewards: [{ item: 'herb', count: 1 }] })).toBe('キラキラ光る場所を調べた！ やくそうを手に入れた！');
  });

  it('spot: 今どおり「○○を手に入れた!」', () => {
    expect(placedTakenText({ kind: 'spot', rewards: [{ item: 'herb', count: 2 }], itemId: 'herb', count: 2 })).toBe('やくそうを2こ手に入れた!');
    expect(placedTakenText({ kind: 'spot', rewards: [{ item: 'herb', count: 1 }] })).toBe('やくそうを手に入れた!');
  });
});

describe('placedStateText', () => {
  it('空は「からっぽだ。」、鍵は hint、hint の無い鍵は「かたく閉じている。」', () => {
    expect(placedStateText('empty', undefined)).toBe('からっぽだ。');
    expect(placedStateText('locked', 'かぎが かかっている。')).toBe('かぎが かかっている。');
    expect(placedStateText('locked', undefined)).toBe('かたく閉じている。');
  });
});

describe('searchMenuLabel / placedSearchFreeAt', () => {
  afterEach(() => setStory(null));

  it('取れる宝箱・空の宝箱・鍵の宝箱は「しらべる」(無料)、ほかは「しらべる (パワー1)」', () => {
    setStory({ placedItems: [
      { id: 'c1', mapId: 'v', x: 1, y: 1, kind: 'chest', rewards: [{ power: 3 }] },
      { id: 'c2', mapId: 'v', x: 2, y: 1, kind: 'chest', rewards: [{ power: 3 }], requireFlags: ['key'] },
      { id: 'k1', mapId: 'v', x: 3, y: 1, kind: 'sparkle', rewards: [{ power: 1 }] },
    ] });
    expect(searchMenuLabel({ mapId: 'v', x: 1, y: 1 }, [], [])).toBe('しらべる');
    expect(searchMenuLabel({ mapId: 'v', x: 1, y: 1 }, [], ['c1'])).toBe('しらべる');
    expect(searchMenuLabel({ mapId: 'v', x: 2, y: 1 }, [], [])).toBe('しらべる');
    expect(placedSearchFreeAt({ mapId: 'v', x: 3, y: 1 }, [], [])).toBe(true);
    expect(searchMenuLabel({ mapId: 'v', x: 3, y: 1 }, [], ['k1'])).toBe('しらべる (パワー1)');
    expect(searchMenuLabel({ mapId: 'v', x: 9, y: 9 }, [], [])).toBe('しらべる (パワー1)');
  });
});
