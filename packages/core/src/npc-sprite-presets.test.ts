import { afterEach, describe, expect, it } from 'vitest';
import { NPC_SPRITE_PRESETS, NPC_SPRITE_PRESET_IDS } from './npc-sprite-presets.js';
import { allNpcs, setNpcs, validateNpcs, type NpcDef } from './npc-data.js';
import { assertTileArt, decodeTileArt } from './tile-art.js';

afterEach(() => setNpcs(null));
describe('npc-sprite-presets', () => {
  it('contains eight distinct original silhouettes and two real drawings, with fixed feet', () => {
    expect(NPC_SPRITE_PRESETS.map((p) => p.id)).toEqual(NPC_SPRITE_PRESET_IDS);
    const silhouettes = new Set<string>();
    for (const preset of NPC_SPRITE_PRESETS) {
      const [a, b] = preset.frames.map(decodeTileArt);
      assertTileArt(a!); assertTileArt(b!);
      expect(a!.size).toBe(16);
      expect(a!.palette[0]).toBe('');
      expect(a!.pixels).not.toEqual(b!.pixels);
      expect(a!.pixels.slice(14 * 16)).toEqual(b!.pixels.slice(14 * 16));
      expect([...a!.pixels].every((p) => p < a!.palette.length)).toBe(true);
      silhouettes.add([...a!.pixels].map((p) => p ? '1' : '0').join(''));
    }
    expect(silhouettes.size).toBe(8);
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
