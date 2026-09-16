import { afterEach, expect, it } from 'vitest';
import { BASE_PALETTE, BASE_PARTS, BIOME_PARTS, TERRAINS, setWorldMap, terrainAt, isWalkableAt, encounterRateFor, itemRateFor, interiorTerrainAt, interiorWalkableAt, tileArtFor, editorColorAt, TERRAIN_COLORS, type Terrain } from '../index.js';

afterEach(() => setWorldMap(null));
it('keeps legacy indices and custom parts while recognizing new terrain IDs in field and interior maps', () => {
  expect(BASE_PALETTE).toEqual(['plains', 'grove', 'forest', 'pond', 'water', 'mountain', 'town', 'bridge']);
  const legacy = [...BASE_PARTS, { name: 'たての橋', terrain: 'bridge', walkable: true }];
  const parts = [...legacy, ...BIOME_PARTS];
  const tiles = new Uint8Array(16); tiles.set([8, 9, 10, 11]);
  setWorldMap({ tiles, size: 4, parts });
  const map = { id: 'biomes', name: '新地形', size: 4, tiles, parts };
  expect(terrainAt(0, 0)).toBe('bridge');
  for (const [x, terrain, walkable] of [[1, 'snowfield', true], [2, 'snowMountain', false], [3, 'desert', true]] as const) {
    expect(terrainAt(x, 0)).toBe(terrain);
    expect(interiorTerrainAt(map, x, 0)).toBe(terrain);
    expect(isWalkableAt(x, 0)).toBe(walkable);
    expect(interiorWalkableAt(map, x, 0)).toBe(walkable);
    expect(TERRAINS).toContain(terrain);
    expect(editorColorAt(x + 8, parts.map(p => p.terrain))).not.toBe('#7a5cff');
    expect(TERRAIN_COLORS[terrain]).toBeTruthy();
    expect(tileArtFor(terrain)?.pixels).toHaveLength(256);
  }
  parts[10] = { ...parts[10]!, walkable: true };
  setWorldMap({ tiles, size: 4, parts });
  expect(isWalkableAt(2, 0)).toBe(true);
  expect(interiorWalkableAt(map, 2, 0)).toBe(true);
  expect(parts.slice(0, 9)).toEqual(legacy);
});
it('uses plains rates for snowfield/desert and mountain rates for snowMountain', () => {
  for (const [terrain, base] of [['snowfield', 'plains'], ['desert', 'plains'], ['snowMountain', 'mountain']] as [Terrain, Terrain][]) {
    expect(encounterRateFor(terrain)).toBe(encounterRateFor(base));
    expect(itemRateFor(terrain)).toBe(itemRateFor(base));
  }
});
