import { describe, expect, it } from 'vitest';
import { BASE_PARTS, WORLD_MAP_ID, WORLD_SIZE, type NpcDef } from '@aozoraquest/core';
import { npcStructuralPlacementError, placementCell, validateNpcPlacement, type NpcPlacementWorld } from './npc-placement';
function data(): NpcPlacementWorld {
  return { tiles: new Uint8Array(WORLD_SIZE ** 2), parts: [...BASE_PARTS, { terrain: 'plains', name: '立入禁止', walkable: false }],
    interiors: [{ id: 'village', name: '村', size: 9, tiles: new Uint8Array(81), parts: [{ terrain: 'plains', name: '床' }, { terrain: 'plains', name: '壁', walkable: false }], inn: { x: 2, y: 2, price: 3 }, shop: { x: 3, y: 3, town: { x: 5, y: 5 } } }],
    gates: [{ from: { mapId: 'village', x: 4, y: 4 }, to: { mapId: WORLD_MAP_ID, x: 8, y: 8 } }],
    towns: [{ x: 5, y: 5, name: '街', region: 0 }], overlay: new Map([[6 * WORLD_SIZE + 6, 'bridge']]), spawn: { x: 5, y: 5 }, arts: new Map(), bundled: false };
}
const npc: NpcDef = { id: 'one', name: 'ひと', x: 1, y: 1, lines: ['やあ'] };
describe('npc-placement', () => {
  it('uses authored terrain (not stale generated overlay), custom walkability and current draft occupancy', () => {
    const w = data();
    w.tiles[6 * WORLD_SIZE + 6] = 4; // Old generated bridge must not override authored water.
    expect(validateNpcPlacement(w, { ...npc, x: 6, y: 6 }, []).reason).toContain('歩けない');
    w.tiles[7 * WORLD_SIZE + 7] = 8;
    expect(validateNpcPlacement(w, { ...npc, x: 7, y: 7 }, []).reason).toContain('歩けない');
    const other = { ...npc, id: 'two', name: 'ほか', x: 1023, y: 2 };
    expect(validateNpcPlacement(w, { ...npc, x: -1, y: 2 }, [other]).reason).toContain('ほか');
    expect(validateNpcPlacement(w, { ...npc, x: -1, y: 2 }, [{ ...other, x: 20 }]).position).toEqual({ mapId: WORLD_MAP_ID, x: 1023, y: 2 });
    expect(validateNpcPlacement(w, npc, [npc]).position).toBeDefined();
  });
  it('rejects facilities, town entrances, invalid ranges, non-integers, and respects interior-owned parts', () => {
    const w = data(); const inside = { ...npc, mapId: 'village' };
    w.interiors[0]!.tiles[1 * 9 + 1] = 1;
    expect(validateNpcPlacement(w, inside, []).reason).toContain('歩けない');
    for (const [x, y, reason] of [[2, 2, '宿屋'], [3, 3, 'なんでも屋'], [4, 4, 'ゲート'], [9, 1, '外']] as const) {
      expect(validateNpcPlacement(w, { ...inside, x, y }, []).reason).toContain(reason);
    }
    expect(validateNpcPlacement(w, { ...npc, x: 5, y: 5 }, []).reason).toContain('街');
    expect(validateNpcPlacement(w, { ...npc, x: 1.1 }, []).reason).toContain('整数');
    expect(validateNpcPlacement(w, { ...npc, mapId: 'gone' }, []).reason).toContain('存在しません');
    expect(validateNpcPlacement(w, { ...npc, x: 8, y: 8 }, []).position).toBeDefined(); // destination allowed
    expect(npcStructuralPlacementError(w, inside)).toBeNull(); // old terrain warning remains compatible
    expect(placementCell(w, 'village', -1, 0)).toBeNull();
  });
});
