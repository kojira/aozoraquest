// @vitest-environment jsdom
/** カジノのマスの床の印 (D-EARLY-002)。両替・景品・台の前の床に、データから付く。カジノの無いマップ・フィールドには付かない。 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BASE_PALETTE, setInteriors, worldOverlay, type InteriorMap } from '@aozoraquest/core';
import { WorldMapLayer } from './world-map-layer';

const F = BASE_PALETTE.indexOf('plains');
const casinoRoom = (): InteriorMap => {
  const t = worldOverlay().towns[0]!;
  return { id: 'casino', name: 'カジノ', size: 16, tiles: new Uint8Array(256).fill(F), casino: { town: { x: t.x, y: t.y }, exchange: { x: 3, y: 4 }, prize: { x: 12, y: 4 }, games: [{ x: 2, y: 7, game: 'slots' }, { x: 7, y: 7, game: 'highlow' }] } };
};
const marks = (at: { x: number; y: number; mapId?: string }) =>
  [...render(<svg><WorldMapLayer at={at} scrollPadding={0} flags={[]} /></svg>).container.querySelectorAll('[data-spot-mark]')].map((e) => e.getAttribute('data-spot-mark'));

afterEach(() => setInteriors(null, null));

describe('WorldMapLayer の床の印', () => {
  it('カジノの両替・景品・台のマスに付く', () => {
    setInteriors([casinoRoom(), { id: 'room', name: 'へや', size: 16, tiles: new Uint8Array(256).fill(F) }], []);
    expect(marks({ x: 8, y: 8, mapId: 'casino' })).toEqual(['3,4', '12,4', '2,7', '7,7']);
    expect(marks({ x: 8, y: 8, mapId: 'room' })).toEqual([]);
    expect(marks({ x: 211, y: 341 })).toEqual([]);
  });
});
