import { describe, it, expect, afterEach } from 'vitest';
import {
  setTownOverrides,
  worldTownOverrides,
  MAX_TOWN_OVERRIDES,
  MAX_TOWN_NAME,
  WorldMapError,
  worldOverlay,
  townAt,
  terrainAt,
  townShopStock,
  regionOf,
  tierForRegion,
} from '../index.js';

/**
 * **街は地形の画像では表せない** (#421)。地図に「街」パーツを置いても、名前も店も宿も
 * 無い「通れるだけのマス」にしかならない。街そのものは差分データで持つ。
 */
describe('街の差分 (#421)', () => {
  afterEach(() => setTownOverrides(null));

  it('街を足すと townAt が返り、地形も街になる', () => {
    const n0 = worldOverlay().towns.length;
    setTownOverrides([{ x: 500, y: 500, name: 'てすとの街' }]);
    expect(worldOverlay().towns.length).toBe(n0 + 1);
    expect(townAt(500, 500)?.name).toBe('てすとの街');
    expect(terrainAt(500, 500)).toBe('town');
    // region は座標から導出する (エディタに書かせない)
    expect(townAt(500, 500)?.region).toBe(regionOf(500, 500));
  });

  it('**店の品揃えは座標から決まる** (足した街にも自動で並ぶ)', () => {
    setTownOverrides([{ x: 500, y: 500, name: 'てすとの街' }]);
    const t = townAt(500, 500)!;
    const stock = townShopStock(t, worldOverlay().towns.indexOf(t));
    expect(stock.equipment.length).toBeGreaterThan(0);
    expect(stock.materialId).toBeTruthy();
    // その帯の grade しか並ばない (#565 の段階化がそのまま効く)
    expect(tierForRegion(t.region)).toBeGreaterThanOrEqual(1);
  });

  it('名前を変える / 消す / 動かす', () => {
    const first = worldOverlay().towns[0]!;
    setTownOverrides([{ x: first.x, y: first.y, name: 'あたらしい名前' }]);
    expect(townAt(first.x, first.y)?.name).toBe('あたらしい名前');

    setTownOverrides([{ x: first.x, y: first.y }]); // 名前なし = 消す
    expect(townAt(first.x, first.y)).toBeNull();

    // 動かす = 元を消して新しい座標に足す
    setTownOverrides([{ x: first.x, y: first.y }, { x: 700, y: 700, name: first.name }]);
    expect(townAt(first.x, first.y)).toBeNull();
    expect(townAt(700, 700)?.name).toBe(first.name);
  });

  it('差分は積み上がらない (置き換え)', () => {
    const n0 = worldOverlay().towns.length;
    setTownOverrides([{ x: 500, y: 500, name: 'A' }]);
    setTownOverrides([{ x: 501, y: 501, name: 'B' }]);
    expect(townAt(500, 500)).toBeNull();
    expect(townAt(501, 501)?.name).toBe('B');
    expect(worldOverlay().towns.length).toBe(n0 + 1);
  });

  it('壊れた 1 件で全体を落とす (部分適用しない)', () => {
    expect(() => setTownOverrides([{ x: 1, y: 1, name: 'ok' }, { x: 1.5, y: 2, name: 'ng' }]))
      .toThrow(WorldMapError);
    expect(worldTownOverrides()).toEqual([]);
    expect(() => setTownOverrides([{ x: 1, y: 1, name: '' }])).toThrow(WorldMapError);
    expect(() => setTownOverrides([{ x: 1, y: 1, name: 'あ'.repeat(MAX_TOWN_NAME + 1) }])).toThrow(WorldMapError);
    const many = Array.from({ length: MAX_TOWN_OVERRIDES + 1 }, (_, i) => ({ x: i, y: 0, name: `t${i}` }));
    expect(() => setTownOverrides(many)).toThrow(WorldMapError);
  });

  it('座標はトーラスに丸める', () => {
    setTownOverrides([{ x: 1024 + 3, y: -2, name: 'まるめ' }]);
    expect(townAt(3, 1022)?.name).toBe('まるめ');
  });
});
