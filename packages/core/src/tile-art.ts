/**
 * **地形のドット絵** (#421)。タイルの見た目を SVG ではなく画素で持つ。
 *
 * 既存のタイルは `world-tiles.tsx` の SVG (32×32 viewBox) で、**コードに直書き**されている。
 * 地形は 256 種まで増える前提なので、増やすたびにコードを書くのは続かない。
 * ドット絵なら**エディタで描いてデータとして持てる**。
 *
 * ## 形式
 *
 * 1 タイル = `size × size` の画素で、各画素は**タイル内パレットの索引 1 バイト**。
 * 色そのものを持たないのは、パレットを差し替えるだけで色調を一括で変えられるから
 * (夜・雪・毒沼のような表現を、絵を描き直さずに出せる)。
 *
 * ```
 * 16×16 = 256 バイト + パレット (最大 16 色 × 7 文字)
 * → 1 地形あたり ~370 バイト。256 地形ぜんぶ描いても ~93 KB
 * ```
 *
 * ## 絵が無くても止まらない
 *
 * 地形を増やすと必ず「絵がまだ無い」状態を通る。そこで描画が落ちたり真っ白になると
 * 編集が始められないので、**絵が無い地形はパレットの代表色で塗りつぶす**
 * (`TERRAIN_COLORS` / `UNKNOWN_TERRAIN_COLOR`)。色だけ決めれば遊べる。
 */
import { DEFAULT_TERRAIN_ARTS } from './terrain-art-data.js';
import { INTERIOR_ARTS } from './interior-art-data.js';

/** ドット絵 1 枚。 */
export interface TileArt {
  /** 一辺の画素数 (8 / 16 / 32 を想定)。 */
  size: number;
  /** タイル内パレット。CSS の色文字列 (`#rrggbb`)。空文字は透明。 */
  palette: string[];
  /** size*size の索引。範囲外の索引は透明として描く。 */
  pixels: Uint8Array;
}

/** ドット絵の一辺として許す値。大きすぎると 256 地形ぶんが重くなる。 */
export const TILE_ART_SIZES = [8, 16, 32] as const;
/** 1 タイル内で使える色数。多すぎると「ドット絵」の作法から外れて描きにくい。 */
export const TILE_ART_MAX_COLORS = 16;

export class TileArtError extends Error {}

/** 空のドット絵 (全画素が透明)。エディタの新規作成用。 */
export function emptyTileArt(size = 16): TileArt {
  assertSize(size);
  return { size, palette: [''], pixels: new Uint8Array(size * size) };
}

function assertSize(size: number): void {
  if (!(TILE_ART_SIZES as readonly number[]).includes(size)) {
    throw new TileArtError(`一辺は ${TILE_ART_SIZES.join(' / ')} のいずれか (${size})`);
  }
}

/** 検証する。**壊れた 1 枚で全体を落とす** — 一部だけ通すとどれが落ちたか分からない。 */
export function assertTileArt(art: TileArt): void {
  assertSize(art.size);
  if (art.pixels.length !== art.size * art.size) {
    throw new TileArtError(`画素数が合わない (${art.pixels.length} ≠ ${art.size}×${art.size})`);
  }
  if (art.palette.length > TILE_ART_MAX_COLORS) {
    throw new TileArtError(`色が多すぎる (${art.palette.length} > ${TILE_ART_MAX_COLORS})`);
  }
  for (const c of art.palette) {
    if (c !== '' && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new TileArtError(`色の書式が不正 (${c})`);
  }
}

/** 保存形式 (JSON に載る形)。`pixels` は base64。 */
export interface TileArtRecord {
  size: number;
  palette: string[];
  /** size*size バイトの base64。 */
  pixels: string;
}

const B64 = typeof btoa === 'function'
  ? { enc: (s: string) => btoa(s), dec: (s: string) => atob(s) }
  // Node 側 (テスト・生成スクリプト) 用のフォールバック。
  : {
      enc: (s: string) => Buffer.from(s, 'binary').toString('base64'),
      dec: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    };

export function encodeTileArt(art: TileArt): TileArtRecord {
  assertTileArt(art);
  let bin = '';
  for (const b of art.pixels) bin += String.fromCharCode(b);
  return { size: art.size, palette: [...art.palette], pixels: B64.enc(bin) };
}

export function decodeTileArt(rec: TileArtRecord): TileArt {
  const bin = B64.dec(rec.pixels);
  const pixels = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pixels[i] = bin.charCodeAt(i);
  const art: TileArt = { size: rec.size, palette: [...rec.palette], pixels };
  assertTileArt(art);
  return art;
}

/** 画素 → 色。索引がパレット外なら透明 (空文字)。 */
export function tileArtColorAt(art: TileArt, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= art.size || y >= art.size) return '';
  return art.palette[art.pixels[y * art.size + x]!] ?? '';
}

// ─── 登録簿 (地形 id → ドット絵) ───────────────────────────
//
// **絵はコードに持たない。** エディタが描いたものを読み込んで差し替える。
// 未登録の地形は代表色で塗る (呼び出し側の責務)。

const registry = new Map<string, TileArt>();

// 同梱の既定絵 (#605)。レコードが無い地形のフォールバック。遅延デコードして使い回す。
const bundled = new Map<string, TileArt>();
function bundledArtFor(terrain: string): TileArt | undefined {
  const hit = bundled.get(terrain);
  if (hit) return hit;
  const rec = DEFAULT_TERRAIN_ARTS[terrain] ?? INTERIOR_ARTS[terrain];
  if (!rec) return undefined;
  const art = decodeTileArt(rec);
  bundled.set(terrain, art);
  return art;
}

/** ドット絵を登録する (エディタの保存 / 起動時の読み込み)。 */
export function setTileArt(terrain: string, art: TileArt | null): void {
  if (!art) {
    registry.delete(terrain);
    return;
  }
  assertTileArt(art);
  registry.set(terrain, art);
}

/**
 * **同梱の既定絵だけ**を引く (登録簿を無視する)。エディタの「同梱の絵に戻す」が使う —
 * 一度でも自分で描くとその絵が恒久的に勝つので、既定に戻す手段が要る。
 */
export function bundledTileArtFor(terrain: string): TileArt | undefined {
  return bundledArtFor(terrain);
}

/** 地形のドット絵。エディタで描いたもの → **同梱の既定絵 (#605)** → undefined (代表色)。 */
export function tileArtFor(terrain: string): TileArt | undefined {
  return registry.get(terrain) ?? bundledArtFor(terrain);
}

/**
 * パーツの絵を引く。**古い保存 (地形名キー) にも当たる。**
 *
 * 絵のキーは元々「地形名」(`water` 等) だったが、同じ地形で絵だけ違うパーツ
 * (「たての橋」) を足せるようにしたとき **index キー (`part:4`)** に変えた。
 * その結果、変更前に描いた絵は編集画面から見つからず、**地図には出るのに
 * 編集画面では SVG に戻る**という食い違いが起きた (地図側は fallback していたため)。
 *
 * 引く側を 1 か所にまとめて、両方が同じ順で探すようにする。
 */
export function partArtFor(index: number, terrain: string): TileArt | undefined {
  // 最後は tileArtFor に倒す = **同梱の既定絵 (#605) にも当たる**。地図は常に
  // index 付きでここを通るので、ここで倒さないと同梱絵は地図に一切出ない
  // (絵タブだけドット絵で地図は SVG、という食い違いになる。レビュー ★★★)。
  return registry.get(partKey(index)) ?? tileArtFor(terrain);
}

/** パーツごとの絵のキー。 */
export function partKey(index: number): string {
  return `part:${index}`;
}

/** モンスターの絵のキー (#591)。地形と同じ登録簿に相乗りする (キー空間が別なので衝突しない)。 */
export function monsterArtKey(id: string): string {
  return `monster:${id}`;
}

/** モンスターの絵 (無ければ undefined = 従来の SVG に倒す)。 */
export function monsterArtFor(id: string): TileArt | undefined {
  return registry.get(monsterArtKey(id));
}

/** 登録済みの地形 id 一覧 (エディタが「描いた地形」を並べるため)。 */
export function tileArtTerrains(): string[] {
  return [...registry.keys()];
}

/** まとめて読み込む (保存レコード → 登録簿)。壊れた 1 枚で全体を落とす。 */
export function loadTileArts(recs: Record<string, TileArtRecord>): void {
  const decoded = Object.entries(recs).map(([k, v]) => [k, decodeTileArt(v)] as const);
  for (const [k, art] of decoded) registry.set(k, art);
}

/** 登録簿を保存形式で吐く。 */
export function dumpTileArts(): Record<string, TileArtRecord> {
  return Object.fromEntries([...registry].map(([k, v]) => [k, encodeTileArt(v)]));
}
