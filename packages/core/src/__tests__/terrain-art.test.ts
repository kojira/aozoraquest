/**
 * 同梱の地形ドット絵 (#605)。base64 に埋めたデータの健全性と、
 * 「レコード → 同梱 → 無し」のフォールバック順を固定する。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DEFAULT_TERRAIN_ARTS } from '../terrain-art-data.js';
import { assertTileArt, decodeTileArt, setTileArt, tileArtFor, TILE_ART_MAX_COLORS, emptyTileArt } from '../tile-art.js';
import { BASE_PALETTE } from '../world-map.js';

describe('DEFAULT_TERRAIN_ARTS', () => {
  it('基本 8 地形すべてに絵がある', () => {
    for (const t of BASE_PALETTE) expect(DEFAULT_TERRAIN_ARTS[t], t).toBeDefined();
  });

  it('全部デコードでき、TileArt として妥当 (16×16・16 色以内・画素がパレット範囲内)', () => {
    for (const [name, rec] of Object.entries(DEFAULT_TERRAIN_ARTS)) {
      const art = decodeTileArt(rec);
      expect(() => assertTileArt(art), name).not.toThrow();
      expect(art.size, name).toBe(16);
      expect(art.pixels.length, name).toBe(256);
      expect(art.palette.length, name).toBeLessThanOrEqual(TILE_ART_MAX_COLORS);
      for (const px of art.pixels) expect(px, name).toBeLessThan(art.palette.length);
    }
  });

  it('草地系の草色が城/ダンジョン入口プリセットと同じ (継ぎ目が格子に見えない)', () => {
    for (const t of ['plains', 'grove', 'pond', 'mountain', 'town'] as const) {
      expect(DEFAULT_TERRAIN_ARTS[t]!.palette, t).toContain('#3f9d3f');
    }
  });
});

describe('tileArtFor のフォールバック', () => {
  afterEach(() => setTileArt('plains', null));

  it('レコード未登録なら同梱の絵が返る', () => {
    expect(tileArtFor('plains')).toBeDefined();
    expect(tileArtFor('plains')!.size).toBe(16);
  });

  it('レコードがあればレコードが勝つ', () => {
    const mine = emptyTileArt(8);
    setTileArt('plains', mine);
    expect(tileArtFor('plains')!.size).toBe(8);
  });

  it('レコードを消すと同梱に戻る (SVG やべた塗りに落ちない)', () => {
    setTileArt('plains', emptyTileArt(8));
    setTileArt('plains', null);
    expect(tileArtFor('plains')!.size).toBe(16);
  });

  it('同梱にも無い地形は undefined (呼び出し側が代表色に倒す)', () => {
    expect(tileArtFor('unknown-terrain-xyz')).toBeUndefined();
  });
});
