import { afterEach, describe, expect, it } from 'vitest';
import { bundledTileArtFor, setTileArt } from '@aozoraquest/core';
import { SHORE_NEIGHBORS, shoreArt, shoreMaskAt, usesStandardShore } from './shore-autotile';

afterEach(() => { setTileArt('water', null); setTileArt('part:4', null); });
describe('shore-autotile', () => {
  it('normalizes all 256 neighbor combinations to 47 complete pixel tiles', () => {
    const masks = new Set<number>();
    for (let neighbors = 0; neighbors < 256; neighbors++) {
      const mask = shoreMaskAt(0, 0, (x, y) => {
        const i = SHORE_NEIGHBORS.findIndex(([dx, dy]) => dx === x && dy === y);
        return neighbors & (1 << i) ? 'water' : 'plains';
      });
      masks.add(mask);
      const art = shoreArt(mask);
      expect(art.pixels).toHaveLength(256);
      expect([...art.pixels].every((p) => !!art.palette[p])).toBe(true);
    }
    expect(masks.size).toBe(47);
    expect(shoreArt(255).pixels).toEqual(bundledTileArtFor('water')!.pixels);
  });
  it('connects pond and bridge; bounds continue water rather than drawing fake land', () => {
    expect(shoreMaskAt(0, 0, (x, y) => x < 0 || y < 0 ? undefined : x === y ? 'bridge' : 'pond')).toBe(255);
    const island = shoreMaskAt(0, 0, (x, y) => x === -1 && y === -1 ? 'plains' : 'water');
    expect(island).toBe(127);
    expect(shoreArt(island).pixels[0]).not.toBe(shoreArt(255).pixels[0]);
    expect(shoreArt(island).pixels[255]).toBe(shoreArt(255).pixels[255]);
  });
  it('keeps terrain and part custom art even if identical to bundled art, and leaves bridges alone', () => {
    expect(usesStandardShore('water', 4)).toBe(true);
    expect(usesStandardShore('pond')).toBe(true);
    expect(usesStandardShore('bridge', 7)).toBe(false);
    setTileArt('part:4', structuredClone(bundledTileArtFor('water')!));
    expect(usesStandardShore('water', 4)).toBe(false);
    expect(usesStandardShore('water')).toBe(true); // interior own parts do not share field indices
    setTileArt('water', structuredClone(bundledTileArtFor('water')!));
    expect(usesStandardShore('water')).toBe(false);
  });
});
