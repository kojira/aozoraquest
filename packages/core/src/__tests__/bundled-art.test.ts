/**
 * **同梱の絵はすべて TileArt の規約を満たす** (#626 の事故対策)。
 *
 * 内部マップの絵を足したとき、共通の色見本 21 色を全タイルのパレットに入れてしまい
 * (実際に使うのは 3〜8 色)、**16 色制限に引っかかって村の読み込みが落ちた**。
 * 絵を足すたびに手で確かめるのは続かないので、同梱の絵を全部まとめて検証する。
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_TERRAIN_ARTS } from '../terrain-art-data.js';
import { INTERIOR_ARTS } from '../interior-art-data.js';
import { PART_PRESETS } from '../part-presets.js';
import { assertTileArt, decodeTileArt, TILE_ART_MAX_COLORS, type TileArtRecord } from '../tile-art.js';

const ALL: Array<[string, TileArtRecord]> = [
  ...Object.entries(DEFAULT_TERRAIN_ARTS).map(([k, v]) => [`terrain:${k}`, v] as [string, TileArtRecord]),
  ...Object.entries(INTERIOR_ARTS).map(([k, v]) => [`interior:${k}`, v] as [string, TileArtRecord]),
  ...PART_PRESETS.map((p) => [`preset:${p.name}`, p.art] as [string, TileArtRecord]),
];

describe('同梱の絵', () => {
  it('数が減っていない (足した絵が消えていないこと)', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(20);
  });

  for (const [name, rec] of ALL) {
    it(`${name}: 16 色以内で、デコードでき、画素がパレット範囲内`, () => {
      expect(rec.palette.length, `${name} の色数`).toBeLessThanOrEqual(TILE_ART_MAX_COLORS);
      const art = decodeTileArt(rec);
      expect(() => assertTileArt(art)).not.toThrow();
      expect(art.size).toBe(16);
      expect(art.pixels.length).toBe(256);
      for (const px of art.pixels) expect(px, `${name} の画素`).toBeLessThan(art.palette.length);
    });

    it(`${name}: 使っていない色をパレットに残していない`, () => {
      // 残っていても動くが、16 色制限を無駄に食って**足せる色が減る**
      // (実際にこれで上限超過を出した)。
      const art = decodeTileArt(rec);
      const used = new Set(art.pixels);
      const unused = art.palette.map((_, i) => i).filter((i) => i !== 0 && !used.has(i));
      expect(unused, `${name} の未使用色`).toEqual([]);
    });

    it(`${name}: palette[0] は透明 (エディタの消しゴム規約)`, () => {
      expect(rec.palette[0], name).toBe('');
    });
  }
});
