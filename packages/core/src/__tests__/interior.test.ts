/**
 * 内部マップとゲート (#424)。守るべき不変条件:
 * - **行き先が実在しないゲートを保存させない** (踏むとどこにも居ない状態になる)
 * - 内部マップは端で折り返さない (範囲外は歩けない = 外に出るのはゲートだけ)
 * - 同じマスに 2 つのゲートを置かせない (どちらへ行くのか決められない)
 * - 壊れた 1 件で全体を落とす
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  InteriorError,
  MAX_INTERIOR_SIZE,
  WORLD_MAP_ID,
  allGates,
  allInteriors,
  gateAt,
  gateOpen,
  interiorById,
  interiorTerrainAt,
  interiorWalkableAt,
  isInterior,
  setInteriors,
  walkableIn,
  type InteriorMap,
} from '../interior.js';
import { BASE_PALETTE } from '../world-map.js';

const FLOOR = BASE_PALETTE.indexOf('plains');
const WALL = BASE_PALETTE.indexOf('mountain');

/** 外周が壁・中が床の 8×8。 */
function room(id = 'in-1', size = 8): InteriorMap {
  const tiles = new Uint8Array(size * size).fill(FLOOR);
  for (let k = 0; k < size; k++) {
    tiles[k] = WALL;
    tiles[(size - 1) * size + k] = WALL;
    tiles[k * size] = WALL;
    tiles[k * size + size - 1] = WALL;
  }
  return { id, name: 'へや', size, tiles };
}

afterEach(() => setInteriors(null, null));

describe('setInteriors', () => {
  it('登録した内部マップを id で引ける', () => {
    setInteriors([room()], []);
    expect(interiorById('in-1')?.name).toBe('へや');
    expect(allInteriors()).toHaveLength(1);
    expect(isInterior('in-1')).toBe(true);
    expect(isInterior(WORLD_MAP_ID)).toBe(false);
    expect(isInterior(undefined)).toBe(false);
  });

  it('null で全解除', () => {
    setInteriors([room()], [{ from: { mapId: 'in-1', x: 1, y: 1 }, to: { mapId: WORLD_MAP_ID, x: 5, y: 5 } }]);
    setInteriors(null, null);
    expect(allInteriors()).toHaveLength(0);
    expect(allGates()).toHaveLength(0);
    expect(interiorById('in-1')).toBeUndefined();
  });

  it("id に 'world' は使えない (フィールドの予約語)", () => {
    expect(() => setInteriors([{ ...room(), id: WORLD_MAP_ID }], [])).toThrow(InteriorError);
  });

  it('id 重複・名前空・おおきさ範囲外・タイル数不一致を弾く', () => {
    expect(() => setInteriors([room('a'), room('a')], [])).toThrow(InteriorError);
    expect(() => setInteriors([{ ...room(), name: ' ' }], [])).toThrow(InteriorError);
    expect(() => setInteriors([{ ...room(), size: 3 }], [])).toThrow(InteriorError);
    expect(() => setInteriors([{ ...room(), size: MAX_INTERIOR_SIZE + 1 }], [])).toThrow(InteriorError);
    expect(() => setInteriors([{ ...room(), tiles: new Uint8Array(5) }], [])).toThrow(InteriorError);
  });

  it('危険度は 1〜8 (省略で敵なし)', () => {
    setInteriors([{ ...room(), encounterTier: 3 }], []);
    expect(interiorById('in-1')!.encounterTier).toBe(3);
    expect(() => setInteriors([{ ...room(), encounterTier: 0 }], [])).toThrow(InteriorError);
    expect(() => setInteriors([{ ...room(), encounterTier: 9 }], [])).toThrow(InteriorError);
  });
});

describe('ゲート', () => {
  it('登録したゲートを座標で引ける', () => {
    const g = { from: { mapId: WORLD_MAP_ID, x: 10, y: 20 }, to: { mapId: 'in-1', x: 4, y: 6 } };
    setInteriors([room()], [g]);
    expect(gateAt(WORLD_MAP_ID, 10, 20)).toEqual(g);
    expect(gateAt(WORLD_MAP_ID, 10, 21)).toBeUndefined();
    expect(gateAt('in-1', 10, 20)).toBeUndefined(); // マップが違えば別のマス
  });

  it('行き先の内部マップが存在しないゲートを弾く (踏むとどこにも居なくなる)', () => {
    expect(() => setInteriors([room()], [
      { from: { mapId: WORLD_MAP_ID, x: 1, y: 1 }, to: { mapId: 'ghost', x: 0, y: 0 } },
    ])).toThrow(InteriorError);
  });

  it('行き先が内部マップの外を指すゲートを弾く', () => {
    expect(() => setInteriors([room()], [
      { from: { mapId: WORLD_MAP_ID, x: 1, y: 1 }, to: { mapId: 'in-1', x: 99, y: 0 } },
    ])).toThrow(InteriorError);
  });

  it('同じマスのゲート重複を弾く', () => {
    expect(() => setInteriors([room()], [
      { from: { mapId: WORLD_MAP_ID, x: 1, y: 1 }, to: { mapId: 'in-1', x: 2, y: 2 } },
      { from: { mapId: WORLD_MAP_ID, x: 1, y: 1 }, to: { mapId: 'in-1', x: 3, y: 3 } },
    ])).toThrow(InteriorError);
  });

  it('壊れたゲート 1 本で全体を落とす (マップも入らない)', () => {
    expect(() => setInteriors([room()], [
      { from: { mapId: WORLD_MAP_ID, x: 1, y: 1 }, to: { mapId: 'ghost', x: 0, y: 0 } },
    ])).toThrow(InteriorError);
    expect(allInteriors()).toHaveLength(0);
  });
});

describe('通行判定', () => {
  it('床は歩けて外周の壁は歩けない', () => {
    const m = room();
    expect(interiorWalkableAt(m, 4, 4)).toBe(true);
    expect(interiorWalkableAt(m, 0, 4)).toBe(false);
  });

  it('**範囲外は歩けない** (内部マップは端で折り返さない)', () => {
    const m = room();
    expect(interiorWalkableAt(m, -1, 4)).toBe(false);
    expect(interiorWalkableAt(m, m.size, 4)).toBe(false);
    expect(interiorWalkableAt(m, 4, -1)).toBe(false);
    expect(interiorWalkableAt(m, 4, m.size)).toBe(false);
  });

  it('範囲外の地形は壁 (歩けない地形) 扱い', () => {
    expect(interiorTerrainAt(room(), -1, 0)).toBe('mountain');
  });

  it('walkableIn は内部なら内部の判定、それ以外はフィールドの判定に委ねる', () => {
    setInteriors([room()], []);
    const worldWalkable = () => true; // フィールドは何でも歩ける、という代役
    expect(walkableIn('in-1', 4, 4, worldWalkable)).toBe(true);
    expect(walkableIn('in-1', 0, 0, worldWalkable)).toBe(false); // 壁
    expect(walkableIn(WORLD_MAP_ID, 0, 0, worldWalkable)).toBe(true); // 代役が答える
    expect(walkableIn('unknown-map', 0, 0, worldWalkable)).toBe(true); // 未知はフィールド扱い
  });

  it('パーツ自身の通行値がタイルの地形より優先される', () => {
    const tiles = new Uint8Array(16).fill(0);
    const m: InteriorMap = {
      id: 'in-x', name: 'x', size: 4, tiles,
      // index 0 = 見た目は山だが通れる隘路
      parts: [{ terrain: 'mountain', name: 'ぬけみち', walkable: true }],
    };
    setInteriors([m], []);
    expect(interiorWalkableAt(interiorById('in-x')!, 1, 1)).toBe(true);
  });
});

describe('ゲートの解禁フラグ (#426 エリア解放)', () => {
  const gate = (requireFlags?: string[]) => ({
    from: { mapId: WORLD_MAP_ID, x: 5, y: 5 }, to: { mapId: 'in-1', x: 4, y: 4 },
    ...(requireFlags ? { requireFlags } : {}),
  });

  it('フラグ指定が無ければ常に通れる', () => {
    setInteriors([room()], [gate()]);
    expect(gateOpen(gateAt(WORLD_MAP_ID, 5, 5)!, [])).toBe(true);
  });

  it('指定フラグが全部立つまで通れない', () => {
    setInteriors([room()], [gate(['castle_open', 'king_met'])]);
    const g = gateAt(WORLD_MAP_ID, 5, 5)!;
    expect(gateOpen(g, [])).toBe(false);
    expect(gateOpen(g, ['castle_open'])).toBe(false); // 片方だけでは開かない
    expect(gateOpen(g, ['castle_open', 'king_met'])).toBe(true);
  });

  it('フラグ名の書式を弾く (typo は永久に開かないゲートになる)', () => {
    expect(() => setInteriors([room()], [gate(['Castle_Open'])])).toThrow(InteriorError);
    expect(() => setInteriors([room()], [gate(['castle open'])])).toThrow(InteriorError);
  });

  it('保存して読み直しても解禁フラグが残る', () => {
    setInteriors([room()], [gate(['castle_open'])]);
    expect(allGates()[0]!.requireFlags).toEqual(['castle_open']);
  });
});
