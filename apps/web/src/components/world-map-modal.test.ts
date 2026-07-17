import { describe, expect, it } from 'vitest';
import { nearestTown } from './world-map-modal';
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
