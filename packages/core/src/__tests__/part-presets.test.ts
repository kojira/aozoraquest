/**
 * 同梱パーツプリセット (#424 段階 1)。base64 に埋めた絵が壊れていると
 * エディタで追加した瞬間に落ちるので、データの健全性をここで固定する。
 */
import { describe, it, expect } from 'vitest';
import { PART_PRESETS, presetArt } from '../part-presets.js';
import { assertTileArt, TILE_ART_MAX_COLORS } from '../tile-art.js';
import { BASE_PALETTE, setWorldParts, worldParts } from '../world-map.js';

describe('PART_PRESETS', () => {
  it('城とダンジョン入口が入っている', () => {
    expect(PART_PRESETS.map((p) => p.name)).toEqual(['城', 'ダンジョン入口']);
  });

  it('絵がデコードでき、TileArt として妥当 (16×16・16 色以内)', () => {
    for (const p of PART_PRESETS) {
      const art = presetArt(p);
      expect(() => assertTileArt(art)).not.toThrow();
      expect(art.size).toBe(16);
      expect(art.pixels.length).toBe(256);
      expect(art.palette.length).toBeLessThanOrEqual(TILE_ART_MAX_COLORS);
      // 全画素がパレット範囲内 (範囲外は描画で透明/黒化して気づきにくい)
      for (const px of art.pixels) expect(px).toBeLessThan(art.palette.length);
    }
  });

  it('terrain は既知の地形で、setWorldParts の検証を通る', () => {
    const before = [...worldParts()];
    try {
      for (const p of PART_PRESETS) {
        expect(BASE_PALETTE).toContain(p.terrain);
        // 入口はゲート遷移 (#424 段階 3) が入るまで「まだ入れない」壁
        expect(p.walkable).toBe(false);
      }
      expect(() => setWorldParts([...before, ...PART_PRESETS.map((p) => ({ terrain: p.terrain, name: p.name, walkable: p.walkable }))])).not.toThrow();
    } finally {
      setWorldParts(before);
    }
  });
});
