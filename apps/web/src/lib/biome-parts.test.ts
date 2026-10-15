import { afterEach, expect, it } from 'vitest';
import { BASE_PARTS, BIOME_PARTS, tileArtTerrains, setTileArt, tileArtFor, type InteriorMap } from '@aozoraquest/core';
import { appendBiomePart, interiorBiomeParts } from './biome-parts';

const resetTileArts = () => tileArtTerrains().forEach((key) => setTileArt(key, null));
afterEach(resetTileArts);
const room = (): InteriorMap => ({ id: 'room', name: '部屋', size: 4, tiles: new Uint8Array(16) });
it('explicit base conversion preserves terrain art and shared walkability; own parts retain indices', () => {
  const art = tileArtFor('desert')!;
  setTileArt('plains', art);
  const shared = BASE_PARTS.map((p, i) => i === 0 ? { ...p, name: '庭', walkable: false } : p);
  const parts = interiorBiomeParts(room(), shared);
  expect(parts).toEqual(shared);
  const next = appendBiomePart(parts, room().tiles, BIOME_PARTS[0]!, false);
  expect(next.slice(0, 8)).toEqual(shared);
  expect(next[8]?.terrain).toBe('snowfield');
  expect(tileArtFor('plains')).toBe(art);
  const own = { ...room(), parts: [{ terrain: 'desert', name: '既存の砂漠' }] };
  expect(interiorBiomeParts(own, shared)).toEqual(own.parts);
});
it('rejects legacy conversion that would change shared art or terrain, without changing the map', () => {
  const map = room(); const before = structuredClone(map);
  setTileArt('part:0', tileArtFor('plains')!);
  expect(() => interiorBiomeParts(map, BASE_PARTS)).toThrow('共有パーツ');
  resetTileArts();
  expect(() => interiorBiomeParts(map, [{ terrain: 'water', name: '水' }])).toThrow('共有パーツ');
  map.tiles[0] = 8;
  expect(() => interiorBiomeParts(map, BASE_PARTS)).toThrow('共有パーツ');
  map.tiles[0] = 0; expect(map).toEqual(before);
});
it('does not overwrite dangling indices/art or overflow 256 entries', () => {
  const biome = BIOME_PARTS[2]!;
  expect(() => appendBiomePart(BASE_PARTS, new Uint8Array([8]), biome, true)).toThrow('番号');
  setTileArt('part:8', tileArtFor('plains')!);
  expect(() => appendBiomePart(BASE_PARTS, new Uint8Array([0]), biome, true)).toThrow('番号');
  expect(appendBiomePart(BASE_PARTS, new Uint8Array([0]), biome, false)).toHaveLength(9);
  expect(() => appendBiomePart(Array(256).fill(BASE_PARTS[0]), new Uint8Array([0]), biome, true)).toThrow('256');
});
