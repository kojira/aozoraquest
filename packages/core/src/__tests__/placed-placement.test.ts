/**
 * 置きアイテムを置くマスの確認 (D-CHEST-001 §7)。保存のときだけ見る (読み込みでは落とさない)。
 * - 歩けないマス・ゲート・宿屋/店の扉・NPC・固定モンスターの上には置けない
 * - 入口から行けないマスは警告だけ (保存は止めない)
 * - フラグの数は assertStoryFlagTotal と同じ数え方
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureNpcPlacementWorld, placedItemPlacementIssue, placedItemReachable, placedItemsSaveIssue, setInteriors, setNpcs, setWorldMap, storyFlagCount,
  WORLD_SIZE, type InteriorMap, type NpcDef, type PlacedItemDef,
} from '../index.js';

// 7×7 の部屋。外周は壁 (index 1 = 歩けない)、(3,1)〜(3,5) に壁の仕切り、(1,1) が入口。
const W = 7;
const tiles = new Uint8Array(W * W);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || x === W - 1 || y === W - 1 || (x === 3 && y >= 1)) tiles[y * W + x] = 1;
const ROOM: InteriorMap = {
  id: 'room', name: 'へや', size: W, tiles,
  parts: [{ terrain: 'floor-stone', name: '床', walkable: true }, { terrain: 'wall-brick', name: '壁', walkable: false }],
  inn: { x: 2, y: 5, price: 1 },
} as InteriorMap;
const NPC: NpcDef = { id: 'n', name: 'むらびと', mapId: 'room', x: 2, y: 3, lines: ['やあ'] };
const at = (x: number, y: number, over: Partial<PlacedItemDef> = {}): PlacedItemDef => ({ id: 'c', mapId: 'room', x, y, kind: 'chest', rewards: [{ power: 1 }], ...over });

describe('placedItemPlacementIssue / placedItemReachable', () => {
  beforeEach(() => {
    setWorldMap({ tiles: new Uint8Array(WORLD_SIZE * WORLD_SIZE), size: WORLD_SIZE });
    setInteriors([ROOM], [{ from: { mapId: 'world', x: 10, y: 10 }, to: { mapId: 'room', x: 1, y: 1 } }, { from: { mapId: 'room', x: 1, y: 2 }, to: { mapId: 'world', x: 10, y: 11 } }]);
    setNpcs([NPC]);
  });
  afterEach(() => { setNpcs(null); setInteriors(null, null); setWorldMap(null); });
  const world = () => captureNpcPlacementWorld([NPC], false);

  it('歩ける空きマスは置ける', () => {
    expect(placedItemPlacementIssue(world(), at(2, 2), [NPC], [])).toBeNull();
  });

  it('壁・ゲート・宿屋・NPC・固定モンスター・マップの外には置けない', () => {
    expect(placedItemPlacementIssue(world(), at(0, 0), [NPC], [])).toMatch(/歩けない/);
    expect(placedItemPlacementIssue(world(), at(1, 2), [NPC], [])).toMatch(/ゲート/);
    expect(placedItemPlacementIssue(world(), at(2, 5), [NPC], [])).toMatch(/宿屋/);
    expect(placedItemPlacementIssue(world(), at(2, 3), [NPC], [])).toMatch(/むらびと/);
    expect(placedItemPlacementIssue(world(), at(2, 4), [NPC], [{ mapId: 'room', x: 2, y: 4 }])).toMatch(/固定モンスター/);
    expect(placedItemPlacementIssue(world(), at(9, 9), [NPC], [])).toMatch(/外/);
  });

  it('入口から行けないマス (壁の向こう) は false', () => {
    expect(placedItemReachable(world(), at(2, 4), [NPC])).toBe(true);
    expect(placedItemReachable(world(), at(5, 3), [NPC])).toBe(false);
  });

  it('フラグの数: シナリオ・flag のある置きアイテム・戦闘の勝ち負けを重複なしで数える', () => {
    const events = [{ id: 'e', title: 't', when: [], setFlags: ['a', 'b'] }];
    expect(storyFlagCount(events, { placedItems: [at(1, 1), at(2, 2, { id: 'd', flag: 'a' }), at(2, 1, { id: 'e', flag: 'c' })], battles: [{ id: 'b', monsterId: 'm', count: 1, winFlag: 'w', loseFlag: 'l' }] })).toBe(5);
  });
});

describe('placedItemsSaveIssue', () => {
  beforeEach(() => {
    setWorldMap({ tiles: new Uint8Array(WORLD_SIZE * WORLD_SIZE), size: WORLD_SIZE });
    setInteriors([ROOM], []);
  });
  afterEach(() => { setInteriors(null, null); setWorldMap(null); });

  it('新しく置いた・動かしたものだけを見る (動かしていない既存の壁の上は止めない)', () => {
    const world = captureNpcPlacementWorld([], false);
    const wall = at(0, 0, { id: 'old' });
    expect(placedItemsSaveIssue(world, [wall], [wall], [], [])).toBeNull();
    expect(placedItemsSaveIssue(world, [wall, at(0, 1, { id: 'new' })], [wall], [], [])).toMatch(/^new: .*歩けない/);
    expect(placedItemsSaveIssue(world, [at(3, 2, { id: 'old' })], [at(2, 2, { id: 'old' })], [], [])).toMatch(/^old: /);
  });
});
