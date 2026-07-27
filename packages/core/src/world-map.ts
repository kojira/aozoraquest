/**
 * ワールドの**地形をタイル 1 つ 1 バイトの画像として持つ** (マップエディタ。#421)。
 *
 * ## なぜ画像か
 *
 * 地形は今まで `baseTerrainAt` が 1024×1024 を毎回ノイズから計算していた。
 * エディタで手編集するには差分を持つしかないが、疎な差分は上限が要り
 * 「広い面積を塗ると保存できない」「上限超過で断る」「部分適用しない」といった
 * 問題を丸ごと抱える。**画像なら塗り放題で、しかも小さい**:
 *
 * ```
 * 生バイト (1 タイル 1 バイト) : 1,024 KB
 * gzip 圧縮後                  :    27.4 KB   ← 地形は空間的にまとまるのでよく効く
 * gzip 展開                    :     0.6 ms
 * ```
 *
 * 副産物として**速くなる**。ノイズ計算 3.27 µs/回 に対し、配列参照は 0.010 µs/回で
 * **約 327 倍**。全域スキャンに 3.3 秒かかるのが「ランタイムでは呼ばない」理由だったが、
 * 画像を持てばスキャン自体が不要になり、edge の CPU 時間にも効く。
 *
 * ## パレット
 *
 * **1 バイト = 256 種**。地形はこれから増える前提なので、8 種に固定しない。
 * index → 地形 id の対応は**データとして持ち運ぶ** (`WorldMap.palette`)。
 *
 * **知らない index が来ても壊れないこと**が要点。エディタで新しい地形を足したとき、
 * まだデプロイされていない edge / web がそれを読む瞬間が必ずある。そこで落ちたり
 * 通行判定が狂ったりすると、プレイヤーがその場から動けなくなる。
 * 知らない index は `fallback` (既定 'plains') として扱う。
 */
import type { Terrain } from './world.js';

/** 既知の地形 (index 0〜7)。**並びを変えない** — 既存の地図データの index が全部ずれる。 */
export const BASE_PALETTE: readonly Terrain[] = [
  'plains', // 0
  'grove', // 1
  'forest', // 2
  'pond', // 3
  'water', // 4
  'mountain', // 5
  'town', // 6
  'bridge', // 7
];

/**
 * 地形の**代表色**。地図 (ミニマップ) の描画、エディタのパレット見本、そして
 * **専用の絵がまだ無い地形の代替表示**に使う。
 *
 * 地形を増やすと必ず「パーツ (タイルの絵) が要る」問題が出る。絵が揃うまで
 * 何も描けないと編集が始められないので、**色だけ先に決めれば地図もエディタも動く**
 * ようにしておく。絵 (`world-tiles.tsx` の SVG) は後から差し替える。
 */
export const TERRAIN_COLORS: Record<Terrain, string> = {
  plains: '#9dd07f',
  grove: '#98cc79',
  forest: '#4f9a4f',
  pond: '#57b7ee',
  water: '#57b7ee',
  mountain: '#a8a294',
  town: '#9dd07f', // 街はドットで別描画 (下地は平地色)
  bridge: '#c98d5a',
};

/** 絵も色も無い地形の代替色 (エディタが先に増やした地形はこれで出る)。 */
export const UNKNOWN_TERRAIN_COLOR = '#7a5cff';

/**
 * **エディタ表示用の識別色**。`TERRAIN_COLORS` は「地図で見たときの自然な見た目」なので
 * plains と town、pond と water が**同じ色**になっている (街は下地が平地色、という設計)。
 * それをそのまま編集画面に使うと、**街を塗ったのか平地を塗ったのか画面で判別できない**。
 * 編集中だけは全地形を別の色で出す。
 */
export const EDITOR_TERRAIN_COLORS: Record<Terrain, string> = {
  plains: '#9dd07f',
  grove: '#78bd63',
  forest: '#3f7d3f',
  pond: '#7fd4ff',
  water: '#2f7fd0',
  mountain: '#a8a294',
  town: '#f5d442',
  bridge: '#c98d5a',
};

/** index → 編集用の識別色。 */
export function editorColorAt(index: number, palette: readonly string[] = BASE_PALETTE): string {
  const id = palette[index];
  if (id !== undefined && isKnownTerrain(id)) return EDITOR_TERRAIN_COLORS[id];
  return UNKNOWN_TERRAIN_COLOR;
}

/** index → 色。パレットに知らない地形が入っていても落ちない。 */
export function paletteColorAt(index: number, palette: readonly string[] = BASE_PALETTE): string {
  const id = palette[index];
  if (id !== undefined && isKnownTerrain(id)) return TERRAIN_COLORS[id];
  return UNKNOWN_TERRAIN_COLOR;
}

const isKnownTerrain = (v: string): v is Terrain => (BASE_PALETTE as readonly string[]).includes(v);

/** 1 バイトで表せる地形の上限。 */
export const PALETTE_MAX = 256;

export interface WorldMap {
  /** 1 タイル 1 バイト。長さは size*size。 */
  tiles: Uint8Array;
  /** 一辺のタイル数 (通常 WORLD_SIZE = 1024)。 */
  size: number;
  /**
   * index → 地形 id。省略時は BASE_PALETTE。
   * **このコードが知らない id が入っていてよい** (エディタが先に増やす場合)。
   */
  palette?: readonly string[];
  /** 知らない index / 知らない地形 id をどう扱うか。既定 'plains'。 */
  fallback?: Terrain;
}

export class WorldMapError extends Error {}

let loaded: { tiles: Uint8Array; size: number; lut: Terrain[] } | null = null;
let invalidate: (() => void) | null = null;

/** world.ts から呼ぶ配線 (地図を入れ替えたら派生キャッシュを捨てる)。 */
export function registerWorldMapInvalidator(fn: () => void): void {
  invalidate = fn;
}

/**
 * 地図を差し替える。`null` で解除 (ノイズ生成に戻る)。
 *
 * パレットは**読み込み時に 256 要素の索引表へ展開**する。`terrainAt` は 1 タイルごとに
 * 呼ばれるので、そこで文字列比較や map 引きをしない。
 */
export function setWorldMap(map: WorldMap | null): void {
  if (!map) {
    loaded = null;
    invalidate?.();
    return;
  }
  const { tiles, size } = map;
  if (!Number.isInteger(size) || size <= 0) throw new WorldMapError(`size が不正 (${size})`);
  if (tiles.length !== size * size) {
    throw new WorldMapError(`タイル数が合わない (${tiles.length} ≠ ${size}×${size})`);
  }
  const palette = map.palette ?? BASE_PALETTE;
  if (palette.length > PALETTE_MAX) {
    throw new WorldMapError(`パレットが多すぎる (${palette.length} > ${PALETTE_MAX})`);
  }
  const fallback = map.fallback ?? 'plains';
  if (!isKnownTerrain(fallback)) throw new WorldMapError(`fallback が知らない地形 (${fallback})`);
  // **知らない地形 id は fallback に倒す。** エディタが先に新地形を足しても、
  // 古い edge / web が落ちたり通行判定を間違えたりしない。
  const lut: Terrain[] = new Array(PALETTE_MAX);
  for (let i = 0; i < PALETTE_MAX; i++) {
    const id = palette[i];
    lut[i] = id !== undefined && isKnownTerrain(id) ? id : fallback;
  }
  loaded = { tiles, size, lut };
  invalidate?.();
}

/** 地図が読み込まれているか (無ければ従来のノイズ生成を通す)。 */
export function hasWorldMap(): boolean {
  return loaded !== null;
}

/** 読み込み済みの生バイト (エディタが編集して書き戻すため)。 */
export function worldMapTiles(): Uint8Array | null {
  return loaded?.tiles ?? null;
}

/**
 * 地図から地形を引く。読み込まれていなければ undefined (呼び出し側が生成に倒す)。
 * **座標は呼び出し側で wrap 済みであること** (毎タイル呼ばれるのでここでは丸めない)。
 */
export function mappedTerrainAt(x: number, y: number): Terrain | undefined {
  if (!loaded) return undefined;
  return loaded.lut[loaded.tiles[y * loaded.size + x]!];
}

/** エディタ用: 1 タイル書き換える。範囲外は無視 (呼び出し側で丸める)。 */
export function setMappedTerrain(x: number, y: number, index: number): void {
  if (!loaded) throw new WorldMapError('地図が読み込まれていない');
  if (!Number.isInteger(index) || index < 0 || index >= PALETTE_MAX) {
    throw new WorldMapError(`パレット index が不正 (${index})`);
  }
  loaded.tiles[y * loaded.size + x] = index;
  invalidate?.();
}

// ─── 保存形式 (gzip) ───────────────────────────────────────
//
// PNG ではなく**生バイトの gzip** にする。Cloudflare Workers に PNG デコーダが無く、
// gzip は `DecompressionStream` が標準で使えて依存ゼロ・0.6 ms で解けるため。
// 外部の絵描きツールで作りたい場合は、**エディタ側だけ** PNG の入出力に対応させる
// (ブラウザは canvas で PNG を解ける)。

async function through(data: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(data).then(() => w.close());
  const chunks: Uint8Array[] = [];
  const r = stream.readable.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** 生バイト → gzip。 */
export function encodeWorldMap(tiles: Uint8Array): Promise<Uint8Array> {
  return through(tiles, new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
}

/** gzip → 生バイト。長さが size*size と合わない場合は呼び出し側 (setWorldMap) が弾く。 */
export function decodeWorldMap(gz: Uint8Array): Promise<Uint8Array> {
  return through(gz, new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
}

/**
 * 同梱の地図 (生成結果) を読み込む。**中身はノイズ生成そのままなので見た目は変わらない**が、
 * 以後 `terrainAt` が配列参照になり、全域スキャンが不要になる。
 *
 * 非同期なのは gzip の展開が `DecompressionStream` (async) だから。**読み込むまでは
 * 従来のノイズ生成に倒れる**ので、待たずに遊べるし結果も一致する。
 *
 * 起動時に 1 回だけ呼ぶ想定 (二重呼び出しは同じ Promise を返す)。
 */
let staticLoad: Promise<void> | null = null;
export function loadStaticWorldMap(size = 1024): Promise<void> {
  if (staticLoad) return staticLoad;
  staticLoad = (async () => {
    const { WORLD_MAP_GZ_BASE64 } = await import('./world-map-data.js');
    const bin = atob(WORLD_MAP_GZ_BASE64);
    const gz = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    const tiles = await decodeWorldMap(gz);
    setWorldMap({ tiles, size });
  })().catch((e) => {
    // **落ちてもゲームは続く** (ノイズ生成に倒れるだけ)。次の呼び出しで再試行できるよう戻す。
    staticLoad = null;
    throw e;
  });
  return staticLoad;
}

// ─── 街の差分 ─────────────────────────────────────────────
//
// **街は画像で表せない。** 地形は 1 タイル 1 バイトで済むが、街は名前を持ち、
// 店の品揃えも座標から導出される。地図に「街」パーツを置いただけでは
// **街に見えるだけの通れるマス**にしかならない (名前も店も宿も無い) ので、
// 街そのものは別のデータとして差分で持つ。

/** 街 1 件の差分。`name` が無ければ「その座標の街を消す」。 */
export interface TownOverride {
  x: number;
  y: number;
  name?: string;
}

/** 街の差分の上限。既定は 53 件なので、増やすとしても現実的な範囲に収める。 */
export const MAX_TOWN_OVERRIDES = 500;
/** 街の名前の最大長 (UI と PDS レコードが破綻しない範囲)。 */
export const MAX_TOWN_NAME = 24;

let townOverrides: TownOverride[] = [];

/**
 * 街の差分を差し替える。`null` / 空配列で解除。
 * **壊れた 1 件で全体を落とす** — 一部だけ通すと、どれが落ちたか分からない。
 */
export function setTownOverrides(next: TownOverride[] | null): void {
  const list = next ?? [];
  if (list.length > MAX_TOWN_OVERRIDES) {
    throw new WorldMapError(`街の差分が多すぎる (${list.length} > ${MAX_TOWN_OVERRIDES})`);
  }
  for (const t of list) {
    if (!Number.isInteger(t.x) || !Number.isInteger(t.y)) {
      throw new WorldMapError(`街の座標が整数でない (${t.x}, ${t.y})`);
    }
    if (t.name !== undefined && (t.name.trim() === '' || t.name.length > MAX_TOWN_NAME)) {
      throw new WorldMapError(`街の名前が不正 (${JSON.stringify(t.name)})`);
    }
  }
  townOverrides = list.map((t) => ({ ...t }));
  invalidate?.();
}

/** 適用中の街の差分。 */
export function worldTownOverrides(): readonly TownOverride[] {
  return townOverrides;
}
