import { describe, it, expect, afterEach } from 'vitest';
import {
  emptyTileArt,
  encodeTileArt,
  decodeTileArt,
  assertTileArt,
  tileArtColorAt,
  setTileArt,
  tileArtFor,
  tileArtTerrains,
  loadTileArts,
  dumpTileArts,
  TileArtError,
  TILE_ART_MAX_COLORS,
  partArtFor,
  partKey,
} from '../index.js';

/**
 * **地形のドット絵** (#421)。SVG をコードに直書きする代わりに、画素をデータで持つ。
 *
 * ここで固定するのは「往復で 1 画素も変わらない」「壊れた 1 枚で全体を落とす」
 * 「絵が無い地形でも落ちない」の 3 つ。
 */
describe('地形のドット絵 (#421)', () => {
  afterEach(() => { for (const t of tileArtTerrains()) setTileArt(t, null); });

  it('空の絵は全画素が透明', () => {
    const a = emptyTileArt(16);
    expect(a.pixels.length).toBe(256);
    expect(tileArtColorAt(a, 0, 0)).toBe('');
  });

  it('保存形式の往復で 1 画素も変わらない', () => {
    const a = emptyTileArt(16);
    a.palette = ['', '#9dd07f', '#4f9a4f'];
    for (let i = 0; i < a.pixels.length; i++) a.pixels[i] = i % 3;
    const back = decodeTileArt(encodeTileArt(a));
    expect(back.size).toBe(a.size);
    expect(back.palette).toEqual(a.palette);
    expect(back.pixels).toEqual(a.pixels);
  });

  it('壊れた絵は断る (途中まで読み込まない)', () => {
    expect(() => assertTileArt({ size: 16, palette: [''], pixels: new Uint8Array(10) })).toThrow(TileArtError);
    expect(() => assertTileArt({ size: 7, palette: [''], pixels: new Uint8Array(49) })).toThrow(TileArtError);
    expect(() => assertTileArt({ size: 8, palette: ['nope'], pixels: new Uint8Array(64) })).toThrow(TileArtError);
    const many = Array.from({ length: TILE_ART_MAX_COLORS + 1 }, () => '#000000');
    expect(() => assertTileArt({ size: 8, palette: many, pixels: new Uint8Array(64) })).toThrow(TileArtError);
  });

  it('パレット外の索引は透明として扱う (壊れたデータで落ちない)', () => {
    const a = emptyTileArt(8);
    a.palette = ['', '#ffffff'];
    a.pixels[0] = 200;
    expect(tileArtColorAt(a, 0, 0)).toBe('');
    expect(tileArtColorAt(a, -1, 0)).toBe('');
    expect(tileArtColorAt(a, 99, 0)).toBe('');
  });

  it('登録簿: 絵が無い地形は undefined (呼び出し側が代表色に倒す)', () => {
    expect(tileArtFor('desert')).toBeUndefined();
    const a = emptyTileArt(8);
    a.palette = ['', '#e0c88a'];
    a.pixels.fill(1);
    setTileArt('desert', a);
    expect(tileArtColorAt(tileArtFor('desert')!, 3, 3)).toBe('#e0c88a');
    setTileArt('desert', null);
    expect(tileArtFor('desert')).toBeUndefined();
  });

  it('まとめて読み書きできる (エディタの保存/復元)', () => {
    const a = emptyTileArt(8);
    a.palette = ['', '#123456'];
    a.pixels.fill(1);
    setTileArt('snow', a);
    const dumped = dumpTileArts();
    for (const t of tileArtTerrains()) setTileArt(t, null);
    expect(tileArtFor('snow')).toBeUndefined();
    loadTileArts(dumped);
    expect(tileArtColorAt(tileArtFor('snow')!, 0, 0)).toBe('#123456');
  });

  it('1 地形あたりのデータ量が小さい (256 地形ぶん描いても現実的)', () => {
    const a = emptyTileArt(16);
    a.palette = ['', '#9dd07f', '#4f9a4f', '#7db95f'];
    const size = JSON.stringify(encodeTileArt(a)).length;
    expect(size).toBeLessThan(500); // 16×16 + パレット
    expect(size * 256).toBeLessThan(140_000); // 全 256 地形でも ~130 KB 未満
  });
});

describe('パーツの絵の探し方 (#421)', () => {
  afterEach(() => { for (const t of tileArtTerrains()) setTileArt(t, null); });

  it('**古い保存 (地形名キー) にも当たる**', () => {
    // 絵のキーは元々「地形名」だったが、同じ地形で絵だけ違うパーツを足せるように
    // index キーに変えた。その結果、変更前に描いた絵が編集画面から見つからず、
    // 「地図には出るのに編集画面では SVG に戻る」という食い違いが起きた。
    const a = emptyTileArt(8);
    a.palette = ['', '#57b7ee'];
    a.pixels.fill(1);
    setTileArt('water', a); // 古い形式で保存されている絵
    expect(partArtFor(4, 'water'), '古い保存が見つからない').toBeDefined();
    expect(tileArtColorAt(partArtFor(4, 'water')!, 0, 0)).toBe('#57b7ee');
  });

  it('index キーの絵があればそちらが勝つ (同じ地形で絵を分けられる)', () => {
    const old = emptyTileArt(8);
    old.palette = ['', '#111111'];
    old.pixels.fill(1);
    setTileArt('bridge', old);

    const vertical = emptyTileArt(8);
    vertical.palette = ['', '#222222'];
    vertical.pixels.fill(1);
    setTileArt(partKey(8), vertical); // 「たての橋」= index 8

    expect(tileArtColorAt(partArtFor(7, 'bridge')!, 0, 0)).toBe('#111111'); // よこの橋
    expect(tileArtColorAt(partArtFor(8, 'bridge')!, 0, 0)).toBe('#222222'); // たての橋
  });

  it('どちらも無ければ undefined (呼び出し側が SVG / 代表色に倒す)', () => {
    expect(partArtFor(3, 'pond')).toBeUndefined();
  });
});
