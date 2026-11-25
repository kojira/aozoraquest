import { describe, expect, it } from 'vitest';
import { revealedTowns, nearestTown, visibleStoryTown } from './world-map-modal';
import type { Town } from '@aozoraquest/core';

const towns: Town[] = [
  { x: 100, y: 100, region: 0, name: 'アルファ' },
  { x: 120, y: 100, region: 0, name: 'ブラボー' },
  { x: 1020, y: 10, region: 7, name: 'はしっこ' },
];

describe('nearestTown (トーラス距離 + 半径)', () => {
  it('半径内で最も近い街を返す', () => {
    expect(nearestTown(104, 100, towns, 10)?.name).toBe('アルファ');
    expect(nearestTown(114, 100, towns, 10)?.name).toBe('ブラボー');
  });
  it('半径外なら null', () => {
    expect(nearestTown(500, 500, towns, 24)).toBeNull();
  });
  it('トーラスの継ぎ目をまたいで判定する', () => {
    // (2, 10) から (1020, 10) はラップ距離 6
    expect(nearestTown(2, 10, towns, 10)?.name).toBe('はしっこ');
  });
});

describe('revealedTowns (ちずのかけらの開示フィルタ)', () => {
  it('解禁済みリージョンの街だけ返す', () => {
    const towns = [
      { x: 10, y: 10, region: 0, name: 'a' },
      { x: 200, y: 10, region: 1, name: 'b' },
      { x: 10, y: 200, region: 8, name: 'c' },
    ] as any[];
    expect(revealedTowns(towns, [0, 8]).map((t) => t.name)).toEqual(['a', 'c']);
  });
  it('かけらゼロなら街もゼロ (全図が見える回帰を塞ぐ)', () => {
    const towns = [{ x: 10, y: 10, region: 0, name: 'a' }] as any[];
    expect(revealedTowns(towns, [])).toEqual([]);
  });
});

describe('visibleStoryTown (次の目的地は霧の外だけ。D-EARLY-002)', () => {
  const homura = { x: 320, y: 448, region: 26, name: 'ほむらの街' };
  it('解禁済みリージョンの街なら出す', () => {
    expect(visibleStoryTown(homura, [17, 26])).toEqual(homura);
  });
  it('霧の中・目的地なしなら出さない', () => {
    expect(visibleStoryTown(homura, [17, 18])).toBeNull();
    expect(visibleStoryTown(null, [26])).toBeNull();
    expect(visibleStoryTown(undefined, [26])).toBeNull();
  });
});
