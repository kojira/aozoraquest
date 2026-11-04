/**
 * saveStoryPlacedItems (D-CHEST-001 §7): 置きアイテムだけを差し替え、戦闘と固定モンスターは読んだ値のまま書く。
 * 新しく置いたものが歩けないマスなら書かない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import { captureNpcPlacementWorld, setInteriors, setStory, setWorldMap, WORLD_SIZE, type InteriorMap, type StoryData } from '@aozoraquest/core';

const putRecord = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({})));
vi.mock('./atproto', () => ({ getRecord: vi.fn(), putRecord }));

import { saveStoryPlacedItems } from './world-authoring';

const W = 5;
const tiles = new Uint8Array(W * W);
tiles[0] = 1;
const ROOM = { id: 'room', name: 'へや', size: W, tiles, parts: [{ terrain: 'floor-stone', name: '床', walkable: true }, { terrain: 'wall-brick', name: '壁', walkable: false }] } as InteriorMap;
const SAVED: StoryData = { placedItems: [], battles: [{ id: 'b1', monsterId: 'sky-slime', count: 1, winFlag: 'beat' }], fieldMonsters: [{ id: 'fm', mapId: 'room', x: 4, y: 4, battleId: 'b1' }] };

describe('saveStoryPlacedItems', () => {
  beforeEach(() => { setWorldMap({ tiles: new Uint8Array(WORLD_SIZE * WORLD_SIZE), size: WORLD_SIZE }); setInteriors([ROOM], []); });
  afterEach(() => { setInteriors(null, null); setWorldMap(null); setStory(null); putRecord.mockClear(); });
  const ctx = () => ({ world: captureNpcPlacementWorld([], false), npcs: [], events: [] });

  it('戦闘と固定モンスターはそのまま、置きアイテムだけ差し替えて書く', async () => {
    const chest = { id: 'c1', mapId: 'room', x: 2, y: 2, kind: 'chest' as const, rewards: [{ power: 3 }] };
    await saveStoryPlacedItems({} as Agent, SAVED, [chest], ctx());
    expect(putRecord).toHaveBeenCalledOnce();
    expect(putRecord.mock.calls[0]![3]).toMatchObject({ placedItems: [chest], battles: SAVED.battles, fieldMonsters: SAVED.fieldMonsters, updatedAt: expect.any(String) });
  });

  it('新しく置いたものが壁・固定モンスターのマスなら書かない', async () => {
    for (const at of [{ x: 0, y: 0 }, { x: 4, y: 4 }]) {
      await expect(saveStoryPlacedItems({} as Agent, SAVED, [{ id: 'c1', mapId: 'room', ...at, kind: 'chest', rewards: [{ power: 3 }] }], ctx())).rejects.toThrow(/^c1: /);
    }
    expect(putRecord).not.toHaveBeenCalled();
  });
});
