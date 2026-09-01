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
  innAt,
  interiorShopAt,
  interiorExitFor,
  gateLockedNotice,
  DEFAULT_GATE_LOCKED_NOTICE,
  interiorById,
  interiorTerrainAt,
  interiorWalkableAt,
  isInterior,
  setInteriors,
  walkableIn,
  type Gate,
  type InteriorMap,
} from '../interior.js';
import { BASE_PALETTE } from '../world-map.js';
import { isWalkableAt, worldOverlay } from '../world.js';
import { allNpcs, npcAt, npcsOn, setNpcs, NpcDataError } from '../npc-data.js';
import { starterTownInterior, starterTownGates } from '../interior-samples.js';

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

describe('通れないときのことば (#426)', () => {
  const g = (over: Partial<Gate> = {}): Gate => ({
    from: { mapId: WORLD_MAP_ID, x: 6, y: 6 }, to: { mapId: 'in-1', x: 4, y: 4 },
    requireFlags: ['castle_open'], ...over,
  });

  it('省略時は既定のことば', () => {
    setInteriors([room()], [g()]);
    expect(gateLockedNotice(gateAt(WORLD_MAP_ID, 6, 6)!)).toBe(DEFAULT_GATE_LOCKED_NOTICE);
  });

  it('書いたことばが使われ、保存して読み直しても残る', () => {
    setInteriors([room()], [g({ lockedNotice: '門番が とおせんぼしている。' })]);
    const saved = gateAt(WORLD_MAP_ID, 6, 6)!;
    expect(saved.lockedNotice).toBe('門番が とおせんぼしている。');
    expect(gateLockedNotice(saved)).toBe('門番が とおせんぼしている。');
  });

  it('空文字・長すぎることばを弾く', () => {
    expect(() => setInteriors([room()], [g({ lockedNotice: '  ' })])).toThrow(InteriorError);
    expect(() => setInteriors([room()], [g({ lockedNotice: 'あ'.repeat(200) })])).toThrow(InteriorError);
  });
});

describe('同梱の村「ふたばの村」(#424)', () => {
  const spawnTown = worldOverlay().spawn;
  const village = starterTownInterior(spawnTown);
  const spawn = worldOverlay().spawn;

  it('32×32 で、そのまま保存できる', () => {
    // 最初は 64×64 だったが、最初の街としては歩かされる距離が長すぎた (実機で指摘)。
    expect(village.size).toBe(32);
    expect(village.tiles.length).toBe(32 * 32);
    expect(() => setInteriors([village], starterTownGates(spawn))).not.toThrow();
  });

  it('端まで歩けば外へ出られる (#626 で囲うのをやめた)', () => {
    // 以前は外周を壁で囲って出口 1 マスだけにしていたが、探させるのがストレスだった。
    expect(village.exitTo).toEqual({ mapId: 'world', x: spawnTown.x, y: spawnTown.y + 1 });
  });

  it('入口が歩ける (ゲートは踏めないと機能しない)', () => {
    const [inGate] = starterTownGates(spawn);
    expect(interiorWalkableAt(village, inGate!.to.x, inGate!.to.y)).toBe(true);
  });

  it('入口から宿屋・店・端まで歩いて行ける (閉じ込められない)', () => {
    // 幅優先で到達性を確かめる。建物で導線が塞がっていると詰む。
    const [inGate] = starterTownGates(spawn);
    const seen = new Set<number>();
    const q = [[inGate!.to.x, inGate!.to.y] as const];
    seen.add(inGate!.to.y * village.size + inGate!.to.x);
    while (q.length) {
      const [x, y] = q.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        const k = ny * village.size + nx;
        if (seen.has(k) || !interiorWalkableAt(village, nx, ny)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    expect(seen.has(village.inn!.y * village.size + village.inn!.x), '宿屋').toBe(true);
    expect(seen.has(village.shop!.y * village.size + village.shop!.x), '店').toBe(true);
    // 広場や家の前まで含め、そこそこの広さが繋がっていること (32×32 = 1024 マス)
    expect(seen.size).toBeGreaterThan(700);
  });

  it('戻り先はフィールドの街の 1 マス下 (踏んだ瞬間にまた入らない)', () => {
    const [inGate] = starterTownGates(spawn);
    expect(inGate!.from).toEqual({ mapId: 'world', x: spawn.x, y: spawn.y });
    expect(village.exitTo).toEqual({ mapId: 'world', x: spawn.x, y: spawn.y + 1 });
  });
});

describe('宿屋 (#424)', () => {
  const withInn = (inn: NonNullable<InteriorMap['inn']>) => ({ ...room(), inn });

  it('宿屋のマスを引ける', () => {
    setInteriors([withInn({ x: 4, y: 4, price: 3, name: 'やど' })], []);
    expect(innAt('in-1', 4, 4)?.price).toBe(3);
    expect(innAt('in-1', 5, 4)).toBeUndefined();
    expect(innAt('world', 4, 4)).toBeUndefined();
  });

  it('歩けないマスの宿屋を弾く (踏めない宿屋は永久に使えない)', () => {
    expect(() => setInteriors([withInn({ x: 0, y: 0, price: 3 })], [])).toThrow(InteriorError);
  });

  it('マップの外・宿代の範囲外を弾く', () => {
    expect(() => setInteriors([withInn({ x: 99, y: 4, price: 3 })], [])).toThrow(InteriorError);
    expect(() => setInteriors([withInn({ x: 4, y: 4, price: -1 })], [])).toThrow(InteriorError);
    expect(() => setInteriors([withInn({ x: 4, y: 4, price: 999 })], [])).toThrow(InteriorError);
  });

  it('ふたばの村の宿屋は歩けるマスにある', () => {
    const v = starterTownInterior(worldOverlay().spawn);
    expect(v.inn).toBeDefined();
    expect(interiorWalkableAt(v, v.inn!.x, v.inn!.y)).toBe(true);
  });
});

describe('村のなんでも屋 (#424)', () => {
  const spawn2 = worldOverlay().spawn;
  const v = starterTownInterior(spawn2);

  it('店の扉が歩けて、指す街が実在する', () => {
    expect(v.shop).toBeDefined();
    expect(interiorWalkableAt(v, v.shop!.x, v.shop!.y)).toBe(true);
    expect(() => setInteriors([v], starterTownGates(spawn2))).not.toThrow();
    expect(interiorShopAt(v.id, v.shop!.x, v.shop!.y)?.town).toEqual({ x: spawn2.x, y: spawn2.y });
  });

  it('存在しない街を指す店を弾く (品揃えを引けない = 開けない店になる)', () => {
    expect(() => setInteriors([{ ...v, shop: { x: 21, y: 22, town: { x: 1, y: 1 } } }], [])).toThrow(InteriorError);
  });

  it('歩けないマスの店を弾く', () => {
    // 宿屋の屋根の上 (囲いをやめたので外周は草地 = 歩ける)。
    expect(interiorWalkableAt(v, 8, 6)).toBe(false);
    expect(() => setInteriors([{ ...v, shop: { x: 8, y: 6, town: { x: spawn2.x, y: spawn2.y } } }], [])).toThrow(InteriorError);
  });

  it('宿屋と店は別のマス (同じだとどちらが開くのか決まらない)', () => {
    expect([v.inn!.x, v.inn!.y]).not.toEqual([v.shop!.x, v.shop!.y]);
  });
});

describe('端から出る (#626)', () => {
  const spawn3 = worldOverlay().spawn;
  const v3 = starterTownInterior(spawn3);

  it('マップの外へ踏み出したときだけ出る先を返す', () => {
    expect(interiorExitFor(v3, 15, 32)).toEqual({ mapId: 'world', x: spawn3.x, y: spawn3.y + 1 }); // 下の端の外
    expect(interiorExitFor(v3, -1, 15)).toBeDefined(); // 左の端の外
    expect(interiorExitFor(v3, 15, 30)).toBeUndefined(); // 中を歩く分には出ない
  });

  it('exitTo が無いマップは端で止まる (囲われた内部)', () => {
    const { exitTo: _e, ...walled } = v3;
    expect(interiorExitFor(walled as typeof v3, 15, 32)).toBeUndefined();
  });

  it('村は囲われていない — どの端からでも出られる', () => {
    // 端の外はどこでも exitTo が返る (出口 1 マスを探させない)。
    const S = v3.size;
    for (const [x, y] of [[0, -1], [S - 1, -1], [-1, 0], [S, S - 1], [10, S]] as const) {
      expect(interiorExitFor(v3, x, y), `(${x},${y})`).toBeDefined();
    }
  });

  it('出る先が存在しない内部マップだと保存できない', () => {
    expect(() => setInteriors([{ ...v3, exitTo: { mapId: 'ghost', x: 0, y: 0 } }], [])).toThrow(InteriorError);
  });
});

describe('内部マップの NPC (#613)', () => {
  afterEach(() => { setInteriors(null, null); setNpcs(null); });

  it('内部マップに置いた NPC のマスは walkableIn で塞がり、隣接から npcAt で引ける', () => {
    setInteriors([room()], []);
    expect(walkableIn('in-1', 3, 3, isWalkableAt)).toBe(true);
    setNpcs([{ id: 'n', name: 'ばんへい', mapId: 'in-1', x: 3, y: 3, lines: ['とまれ。'] }]);
    expect(walkableIn('in-1', 3, 3, isWalkableAt), 'NPC のマスは塞がる').toBe(false);
    expect(walkableIn('in-1', 4, 3, isWalkableAt), '隣のマスは歩ける').toBe(true);
    // 隣から「ぶつかる」= その先のマスを引く
    expect(npcAt('in-1', 3, 3)?.name).toBe('ばんへい');
    expect(npcAt('in-1', 4, 3)).toBeUndefined();
    // 内部マップの NPC はフィールドの同じ座標には現れない (幽霊にならない)
    expect(npcAt(WORLD_MAP_ID, 3, 3)).toBeUndefined();
    expect(npcsOn('in-1').map((n) => n.id)).toEqual(['n']);
    expect(npcsOn(WORLD_MAP_ID)).toEqual([]);
    // 宿屋・店・ゲート入口の検証に使う interiorWalkableAt は NPC を見ない
    expect(interiorWalkableAt(interiorById('in-1')!, 3, 3)).toBe(true);
  });

  it('mapId の無い旧レコードはフィールドの NPC として読める', () => {
    setInteriors([room()], []);
    // フィールドで歩けるマスを探す
    let X = 0, Y = 0;
    outer: for (let y = 300; y < 340; y++) for (let x = 200; x < 240; x++) {
      if (isWalkableAt(x, y)) { X = x; Y = y; break outer; }
    }
    setNpcs([{ id: 'old', name: 'むらびと', x: X, y: Y, lines: ['やあ。'] }]);
    expect(allNpcs()[0]?.mapId).toBeUndefined();
    expect(npcAt(WORLD_MAP_ID, X, Y)?.id).toBe('old');
    expect(walkableIn(WORLD_MAP_ID, X, Y, isWalkableAt)).toBe(false);
    expect(npcsOn(WORLD_MAP_ID).map((n) => n.id)).toEqual(['old']);
    // 同じ座標でも内部マップには居ない
    expect(npcAt('in-1', X, Y)).toBeUndefined();
    expect(walkableIn('in-1', Math.min(X, 6), Math.min(Y, 6), isWalkableAt)).toBe(true);
  });

  it('内部マップの座標は折り返さない (フィールドと別の規則)', () => {
    setInteriors([room()], []);
    setNpcs([{ id: 'n', name: 'ばんへい', mapId: 'in-1', x: 3, y: 3, lines: ['とまれ。'] }]);
    expect(npcAt('in-1', 3 + 1024, 3)).toBeUndefined();
    expect(npcAt('in-1', 3, 3 - 1024)).toBeUndefined();
  });

  it('同じマスでもマップが違えば別の NPC を置ける / 同じマップの同じマスは弾く', () => {
    const a = { id: 'a', name: 'あ', mapId: 'in-1', x: 3, y: 3, lines: ['や'] };
    expect(() => setNpcs([a, { ...a, id: 'b', mapId: 'in-2' }])).not.toThrow();
    expect(() => setNpcs([a, { ...a, id: 'b' }])).toThrow(NpcDataError);
    expect(() => setNpcs([{ ...a, mapId: ' ' }])).toThrow(NpcDataError);
  });
});
