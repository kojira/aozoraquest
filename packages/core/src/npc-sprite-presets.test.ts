import { afterEach, describe, expect, it } from 'vitest';
import { NPC_SPRITE_PRESETS, NPC_SPRITE_PRESET_IDS } from './npc-sprite-presets.js';
import { allNpcs, setNpcs, validateNpcs, type NpcDef } from './npc-data.js';
import { assertTileArt, decodeTileArt } from './tile-art.js';

afterEach(() => setNpcs(null));
describe('npc-sprite-presets', () => {
  it('contains eight distinct walking silhouettes with fixed faces and opposite limb poses', () => {
    expect(NPC_SPRITE_PRESETS.map((p) => p.id)).toEqual(NPC_SPRITE_PRESET_IDS);
    const silhouettes = new Set<string>();
    for (const preset of NPC_SPRITE_PRESETS.filter((p) => p.id !== 'bluesky')) {
      expect(preset.frames).toHaveLength(2);
      const [a, b] = preset.frames.map(decodeTileArt);
      for (const frame of [a!, b!]) {
        assertTileArt(frame);
        expect(frame.size).toBe(16);
        expect(frame.palette[0]).toBe('');
        expect([...frame.pixels].every((p) => p < frame.palette.length)).toBe(true);
      }
      expect(a!.palette).toEqual(b!.palette);
      expect(a!.pixels.slice(0, 9 * 16), preset.id).toEqual(b!.pixels.slice(0, 9 * 16));
      const region = (pixels: Uint8Array, x0: number, x1: number, y0: number, y1: number) =>
        [...pixels].filter((_, i) => i % 16 >= x0 && i % 16 < x1 && Math.floor(i / 16) >= y0 && Math.floor(i / 16) < y1);
      for (const [x0, x1, y0, y1] of [[3, 6, 9, 12], [10, 13, 9, 12], [4, 8, 14, 16], [8, 12, 14, 16]]) {
        expect(region(a!.pixels, x0!, x1!, y0!, y1!), preset.id).not.toEqual(region(b!.pixels, x0!, x1!, y0!, y1!));
      }
      // The lower/forward foot swaps sides, rather than shifting the whole sprite.
      expect(region(a!.pixels, 4, 8, 15, 16).some(Boolean), preset.id).toBe(true);
      expect(region(b!.pixels, 4, 8, 15, 16).some(Boolean), preset.id).toBe(false);
      expect(region(a!.pixels, 8, 12, 15, 16).some(Boolean), preset.id).toBe(false);
      expect(region(b!.pixels, 8, 12, 15, 16).some(Boolean), preset.id).toBe(true);
      silhouettes.add([...a!.pixels].map((p) => p ? '1' : '0').join(''));
    }
    expect(silhouettes.size).toBe(8);
  });
  it('Bluesky keeps her 32px hat, curl and face fixed while both hands and feet alternate', () => {
    const preset = NPC_SPRITE_PRESETS.find((p) => p.id === 'bluesky')!;
    expect(preset.name).toBe('Blueskyちゃん');
    const [a, b] = preset.frames.map(decodeTileArt);
    for (const frame of [a!, b!]) {
      assertTileArt(frame);
      expect(frame.size).toBe(32);
      expect(frame.palette[0]).toBe('');
      expect([...frame.pixels].every((p) => p < frame.palette.length)).toBe(true);
    }
    expect(a!.palette).toEqual(b!.palette);
    expect(a!.pixels.slice(0, 20 * 32)).toEqual(b!.pixels.slice(0, 20 * 32));
    const region = (pixels: Uint8Array, x0: number, x1: number, y0: number, y1: number) =>
      [...pixels].filter((_, i) => i % 32 >= x0 && i % 32 < x1 && Math.floor(i / 32) >= y0 && Math.floor(i / 32) < y1);
    for (const [x0, x1, y0, y1] of [[8, 12, 20, 26], [20, 24, 20, 26], [11, 16, 29, 32], [17, 22, 29, 32]]) {
      expect(region(a!.pixels, x0!, x1!, y0!, y1!)).not.toEqual(region(b!.pixels, x0!, x1!, y0!, y1!));
    }
    expect(region(a!.pixels, 11, 16, 31, 32).some(Boolean)).toBe(true);
    expect(region(b!.pixels, 11, 16, 31, 32).some(Boolean)).toBe(false);
    expect(region(a!.pixels, 17, 22, 31, 32).some(Boolean)).toBe(false);
    expect(region(b!.pixels, 17, 22, 31, 32).some(Boolean)).toBe(true);
  });
  it('round trips explicit presets; absent preserves legacy records and validation is pure', () => {
    const legacy: NpcDef = { id: 'test', name: '村人', x: 1, y: 1, lines: ['やあ'] };
    setNpcs([legacy]);
    for (const preset of NPC_SPRITE_PRESETS) {
      const next = JSON.parse(JSON.stringify([{ ...legacy, spritePreset: preset.id }]));
      validateNpcs(next);
      expect(allNpcs()).toEqual([legacy]);
      setNpcs(next); expect(allNpcs()).toEqual(next); setNpcs([legacy]);
    }
    for (const spritePreset of ['', 'unknown', 3, null]) {
      expect(() => validateNpcs([{ ...legacy, spritePreset } as NpcDef])).toThrow('標準の絵が不正');
      expect(allNpcs()).toEqual([legacy]);
    }
    expect(allNpcs()[0]).not.toHaveProperty('spritePreset');
  });
});
