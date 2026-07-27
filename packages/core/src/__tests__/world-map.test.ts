import { describe, it, expect, afterEach } from 'vitest';
import {
  setWorldMap,
  hasWorldMap,
  worldMapTiles,
  setMappedTerrain,
  encodeWorldMap,
  decodeWorldMap,
  BASE_PALETTE,
  EDITOR_TERRAIN_COLORS,
  TERRAIN_COLORS,
  editorColorAt,
  loadStaticWorldMap,
  PALETTE_MAX,
  WorldMapError,
  terrainAt,
  isWalkable,
  WORLD_SIZE,
  worldOverlay,
} from '../index.js';

/**
 * **地形をタイル 1 つ 1 バイトの画像として持つ** (マップエディタの土台。#421)。
 *
 * ここで固定するのは 3 つ:
 *  - 地図を読み込むと `terrainAt` がそれを返し、外すと**完全に元へ戻る**
 *    (戻らないと world.test.ts の決定論検証を汚染する)
 *  - **知らない index / 知らない地形 id で壊れない**。エディタが新地形を先に足したとき、
 *    まだデプロイされていない edge / web がそれを読む瞬間が必ずある
 *  - gzip の往復で 1 バイトも変わらない
 */
const SIZE = 8; // テストは小さい地図で回す (1024×1024 は 1 MB)
const makeTiles = (fill = 0) => new Uint8Array(SIZE * SIZE).fill(fill);

describe('地形の地図 (#421)', () => {
  afterEach(() => setWorldMap(null));

  it('読み込むと terrainAt が地図を返し、外すと元に戻る', () => {
    const before = terrainAt(3, 3);
    setWorldMap({ tiles: makeTiles(BASE_PALETTE.indexOf('mountain')), size: SIZE });
    expect(terrainAt(3, 3)).toBe('mountain');
    expect(isWalkable(terrainAt(3, 3))).toBe(false);
    setWorldMap(null);
    expect(hasWorldMap()).toBe(false);
    expect(terrainAt(3, 3)).toBe(before);
  });

  it('地図は街/橋のオーバーレイより優先される (街を海に沈められる)', () => {
    // **実寸の地図でないと優先順を突けない。** 小さい地図だと、街の座標には
    // オーバーレイが無い場所しか当たらず、どちらが先でもテストが通ってしまう。
    const town = worldOverlay().towns[0]!;
    expect(terrainAt(town.x, town.y)).toBe('town');
    const tiles = new Uint8Array(WORLD_SIZE * WORLD_SIZE).fill(BASE_PALETTE.indexOf('water'));
    setWorldMap({ tiles, size: WORLD_SIZE });
    expect(terrainAt(town.x, town.y)).toBe('water');
    expect(isWalkable(terrainAt(town.x, town.y))).toBe(false);
    // 街そのもの (townAt) は別データなので残る — 地形だけが変わる
    expect(worldOverlay().towns.some((t) => t.x === town.x && t.y === town.y)).toBe(true);
  });

  it('**知らない index は fallback に倒す** (新地形を先に足しても壊れない)', () => {
    const tiles = makeTiles(200); // パレット外
    setWorldMap({ tiles, size: SIZE });
    expect(terrainAt(1, 1)).toBe('plains'); // 既定の fallback
    setWorldMap({ tiles, size: SIZE, fallback: 'water' });
    expect(terrainAt(1, 1)).toBe('water');
  });

  it('**パレットに知らない地形 id が入っていても倒す** (エディタが先行する場合)', () => {
    const palette = [...BASE_PALETTE, 'desert', 'snow'];
    const tiles = makeTiles(8); // 'desert' = このコードが知らない
    setWorldMap({ tiles, size: SIZE, palette, fallback: 'plains' });
    expect(terrainAt(0, 0)).toBe('plains');
    // 知っている index は正しく引ける (パレットが伸びても既存がずれない)
    tiles[0] = BASE_PALETTE.indexOf('forest');
    setWorldMap({ tiles, size: SIZE, palette });
    expect(terrainAt(0, 0)).toBe('forest');
  });

  it('1 バイト = 256 種まで持てる', () => {
    expect(PALETTE_MAX).toBe(256);
    const palette = [...BASE_PALETTE, ...Array.from({ length: 248 }, (_, i) => `custom-${i}`)];
    expect(palette.length).toBe(256);
    expect(() => setWorldMap({ tiles: makeTiles(), size: SIZE, palette })).not.toThrow();
    expect(() => setWorldMap({ tiles: makeTiles(), size: SIZE, palette: [...palette, 'over'] }))
      .toThrow(WorldMapError);
  });

  it('タイル数が合わない地図は断る (途中まで読み込まない)', () => {
    expect(() => setWorldMap({ tiles: new Uint8Array(10), size: SIZE })).toThrow(WorldMapError);
    expect(hasWorldMap()).toBe(false);
  });

  it('1 タイルだけ書き換えられる (エディタの塗り)', () => {
    setWorldMap({ tiles: makeTiles(BASE_PALETTE.indexOf('plains')), size: SIZE });
    setMappedTerrain(2, 5, BASE_PALETTE.indexOf('water'));
    expect(terrainAt(2, 5)).toBe('water');
    expect(terrainAt(3, 5)).toBe('plains');
    expect(() => setMappedTerrain(0, 0, 256)).toThrow(WorldMapError);
    expect(() => setMappedTerrain(0, 0, -1)).toThrow(WorldMapError);
  });

  it('gzip の往復で 1 バイトも変わらない', async () => {
    const tiles = makeTiles();
    for (let i = 0; i < tiles.length; i++) tiles[i] = (i * 37) % 256;
    const gz = await encodeWorldMap(tiles);
    const back = await decodeWorldMap(gz);
    expect(back).toEqual(tiles);
  });

  it('実寸 (1024×1024) を gzip すると小さくなる', async () => {
    // 実際の地形は空間的にまとまるのでよく効く。ここでは大きな塊で近似する。
    const tiles = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) tiles[y * WORLD_SIZE + x] = ((x >> 6) + (y >> 6)) % 6;
    }
    const gz = await encodeWorldMap(tiles);
    expect(tiles.length).toBe(1024 * 1024);
    // 生 1 MB が 1/10 以下に収まること (実データでは 27 KB)
    expect(gz.length).toBeLessThan(tiles.length / 10);
  });

  it('同梱の地図はノイズ生成 + 街/橋と**全 1024×1024 タイル**で一致する', async () => {
    // **標本では足りない。** 街 53 + 橋 50 = 103 タイルしか違わない (0.0098%) ので、
    // 5,000 点の抜き取りだと期待ヒット数 0.49 で普通に通り抜ける。実際それで
    // 「橋が water になって渡れない / 街が平地になって入れない」を見逃した。
    const before = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
    const ix = new Map(BASE_PALETTE.map((t, i) => [t, i] as const));
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) before[y * WORLD_SIZE + x] = ix.get(terrainAt(x, y))!;
    }
    await loadStaticWorldMap();
    let diff = 0;
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        if (BASE_PALETTE[before[y * WORLD_SIZE + x]!] !== terrainAt(x, y)) diff++;
      }
    }
    expect(diff, '同梱の地図と生成結果が違う').toBe(0);

    // 街と橋が地図に焼き込まれていること (baseTerrainAt には原理的に入らない)
    for (const t of worldOverlay().towns) expect(terrainAt(t.x, t.y), `街 ${t.name}`).toBe('town');
    for (const b of worldOverlay().bridgeTiles) expect(terrainAt(b.x, b.y), '橋').toBe('bridge');
  });

  it('編集用の色は全地形で異なる (どれを塗ったか画面で分かる)', () => {
    // 地図の見た目 (TERRAIN_COLORS) は plains と town、pond と water が同色。
    // それを編集画面に使うと、街を塗ったのか平地を塗ったのか判別できない。
    const seen = new Map<string, string>();
    for (const [id, color] of Object.entries(EDITOR_TERRAIN_COLORS)) {
      expect(seen.has(color), `${id} と ${seen.get(color)} が同じ色`).toBe(false);
      seen.set(color, id);
    }
    // 地図側は従来どおり衝突していてよい (自然な見た目のため)
    expect(TERRAIN_COLORS.plains).toBe(TERRAIN_COLORS.town);
    expect(editorColorAt(BASE_PALETTE.indexOf('plains')))
      .not.toBe(editorColorAt(BASE_PALETTE.indexOf('town')));
  });
});
