/**
 * あおぞらワールド — 決定的ワールド生成 (docs/19-overworld.md)。
 *
 * 1024×1024 のトーラス世界を固定グローバルシードから手続き生成する。
 * 全ユーザー・クライアント・Worker が同じ世界を**計算で**得る (地形は保存しない)。
 *
 * - 周期つき値ノイズ (格子 index を period で mod) → トーラスで継ぎ目なし
 * - ドメインワープで海岸線のブロブ化を防ぐ
 * - 標高 / 湿度 / 尾根 (川・山脈) の 3 チャンネル + バイオーム規則
 * - 街・橋は全域走査が要るため **一度だけ計算してモジュール内でメモ化**
 *   (現行実装でフルスキャン ~1-2 秒。UI 起動時に 1 回。Worker は DO 起動時に 1 回)
 *
 * ビジュアル確認は docs/overworld-drafts/worldmap.html (本実装と同アルゴリズム)。
 * バランス値は WORLD_TUNING に集約。**リリース後に GLOBAL_SEED や閾値を変えると
 * 全ユーザーの地図・位置の意味が変わるため、変更は世界のリセットに等しい。**
 */

import { WORLD_DATA } from './world-data.js';

// ─── 定数 ───────────────────────────────────────────────────

export const WORLD_SIZE = 1024;
export const REGION_SIZE = 128;
export const REGIONS_PER_SIDE = WORLD_SIZE / REGION_SIZE; // 8
export const REGION_COUNT = REGIONS_PER_SIDE * REGIONS_PER_SIDE; // 64
export const WORLD_SEED = 20260717;

export const WORLD_TUNING = {
  seaLevel: 0.4,
  mountainRidge: 0.8,
  mountainHigh: 0.56,
  peakLevel: 0.735,
  forestMoisture: 0.565,
  groveMoisture: 0.46,
  riverRidge: 0.972,
  /** 川が海岸ノイズ化しないよう、海面 + この余裕より高い陸にだけ川を刻む */
  riverElevGuard: 0.02,
  pondNoise: 0.9,
  /** 池ができる最低湿度 */
  pondMoisture: 0.45,
  /** 平地の「まだら林」: 高周波ノイズがこれ以上の平地は林に。広い平原でも数歩ごとに
   *  景色が変わる (スタート周辺が単調というオーナー指摘 2026-07-17 への対応)。
   *  0.74 では視界ほぼ平地一色の地点が 66% 残った (実測) ため 0.62 に強化 +
   *  forestSpeckle (小さな森の群れ) を追加。「平原だけが続くマップは無し」の指示。 */
  groveSpeckle: 0.62,
  /** 平地の小さな森の群れ (波長 32 のノイズ)。まだら林より稀で大きめの塊。 */
  forestSpeckle: 0.84,
  /** 橋: 幅がこれ以下の川にだけ架かる (これより広い水域 = 海、船で渡る) */
  bridgeMaxSpan: 5,
  /** 橋どうしの最小間隔 (マンハッタン距離) */
  bridgeSpacing: 24,
  /** 街探索の半径 (リージョン中心からのスパイラル) */
  townSearchRadius: 40,
  /** 地形別の遭遇率 (1 歩あたり) */
  encounterRate: { plains: 0.05, grove: 0.1, forest: 0.2, bridge: 0.05, town: 0 },
  /** 地形別のアイテム発見率 (1 歩あたり) */
  itemRate: { plains: 0.03, grove: 0.05, forest: 0.08, bridge: 0, town: 0 },
} as const;

export type Terrain =
  | 'plains'
  | 'grove'
  | 'forest'
  | 'pond'
  | 'water'
  | 'mountain'
  | 'town'
  | 'bridge';

/** 徒歩で通行できる地形 (乗り物なし)。 */
export function isWalkable(t: Terrain): boolean {
  return t === 'plains' || t === 'grove' || t === 'forest' || t === 'town' || t === 'bridge';
}

/** 座標をトーラスに丸める。 */
export function wrap(v: number): number {
  return ((v % WORLD_SIZE) + WORLD_SIZE) % WORLD_SIZE;
}

// ─── 決定的ノイズ ───────────────────────────────────────────

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 周期つき値ノイズ。wavelength は WORLD_SIZE の約数であること。 */
function periodicNoise(x: number, y: number, wavelength: number, seed: number): number {
  const period = WORLD_SIZE / wavelength;
  const u = x / wavelength;
  const v = y / wavelength;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = smooth(u - x0);
  const fy = smooth(v - y0);
  const m = (i: number) => ((i % period) + period) % period;
  const a = hash2(m(x0), m(y0), seed);
  const b = hash2(m(x0 + 1), m(y0), seed);
  const c = hash2(m(x0), m(y0 + 1), seed);
  const d = hash2(m(x0 + 1), m(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

type Octaves = readonly (readonly [number, number])[];

function fbm(x: number, y: number, seed: number, octaves: Octaves): number {
  let sum = 0;
  let wsum = 0;
  for (const [w, weight] of octaves) {
    sum += periodicNoise(x, y, w, seed + w) * weight;
    wsum += weight;
  }
  return sum / wsum;
}

function ridged(x: number, y: number, seed: number, octaves: Octaves): number {
  const n = fbm(x, y, seed, octaves);
  return 1 - Math.abs(2 * n - 1);
}

const ELEV_OCT: Octaves = [[512, 1.0], [256, 0.55], [128, 0.3], [64, 0.16], [32, 0.09], [16, 0.05]];
const MOIST_OCT: Octaves = [[256, 1.0], [128, 0.5], [64, 0.25], [32, 0.12]];

function warp(x: number, y: number): [number, number] {
  const wx = (periodicNoise(x, y, 128, WORLD_SEED * 11 + 5) - 0.5) * 48;
  const wy = (periodicNoise(x, y, 128, WORLD_SEED * 13 + 9) - 0.5) * 48;
  return [x + wx, y + wy];
}

export function elevationAt(x: number, y: number): number {
  const [px, py] = warp(wrap(x), wrap(y));
  return fbm(px, py, WORLD_SEED * 2 + 1, ELEV_OCT);
}

export function moistureAt(x: number, y: number): number {
  return fbm(wrap(x), wrap(y), WORLD_SEED * 3 + 7, MOIST_OCT);
}

function riverValue(x: number, y: number): number {
  return ridged(x, y, WORLD_SEED * 5 + 13, [[256, 1.0], [64, 0.3]]);
}

function mountainRidgeValue(x: number, y: number): number {
  // 波長は必ず WORLD_SIZE の約数にする (96 のような非約数は格子 mod が壊れて
  // トーラスの継ぎ目に不連続を作る。レビューで実測 250 倍の段差が出た教訓)。
  return ridged(x, y, WORLD_SEED * 17 + 29, [[256, 1.0], [64, 0.45], [32, 0.15]]);
}

/** 生成に使う全波長 (テストで WORLD_SIZE の約数であることを固定する)。 */
export const ALL_WAVELENGTHS: readonly number[] = [
  512, 256, 128, 64, 32, 16, // ELEV
  256, 128, 64, 32,          // MOIST
  256, 64,                   // river
  256, 64, 32,               // mountain ridge
  128,                       // warp
  8,                         // pond
  16,                        // grove speckle (平地のまだら林)
  32,                        // forest speckle (平地の小さな森)
];

// ─── 地形 ───────────────────────────────────────────────────

/** 街・橋の上書き**前**の素の地形。 */
export function baseTerrainAt(xIn: number, yIn: number): Exclude<Terrain, 'town' | 'bridge'> {
  const x = wrap(xIn);
  const y = wrap(yIn);
  const t = WORLD_TUNING;
  const e = elevationAt(x, y);
  if (e < t.seaLevel) return 'water';
  if (e >= t.peakLevel) return 'mountain';
  if (e >= t.mountainHigh && mountainRidgeValue(x, y) >= t.mountainRidge) return 'mountain';
  if (e > t.seaLevel + t.riverElevGuard && riverValue(x, y) > t.riverRidge) return 'water';
  if (periodicNoise(x, y, 8, WORLD_SEED * 7 + 3) > t.pondNoise && moistureAt(x, y) > t.pondMoisture) return 'pond';
  const m = moistureAt(x, y);
  if (m >= t.forestMoisture) return 'forest';
  if (m >= t.groveMoisture) return 'grove';
  // 平地の小さな森の群れ (波長 32) と、まだら林 (波長 16)。広い平原を作らない。
  if (periodicNoise(x, y, 32, WORLD_SEED * 29 + 53) > t.forestSpeckle) return 'forest';
  if (periodicNoise(x, y, 16, WORLD_SEED * 23 + 41) > t.groveSpeckle) return 'grove';
  return 'plains';
}

/**
 * タイルの見た目バリエーション (0..3)。座標ハッシュで決定的。
 * 平地の花・岩・草むら等、**地形は変えずに視覚的な単調さを消す** ための番号
 * (「平原だけが続くマップは無し」への対応の一部。描画側が variant を持つ)。
 */
export function tileDetailAt(x: number, y: number): 0 | 1 | 2 | 3 {
  return (Math.floor(hash2(wrap(x), wrap(y), WORLD_SEED * 31 + 71) * 4) & 3) as 0 | 1 | 2 | 3;
}

/** 川タイルか (水のうち海面より高いもの = 橋を架けられる)。 */
function isRiverAt(x: number, y: number): boolean {
  return baseTerrainAt(x, y) === 'water' && elevationAt(x, y) >= WORLD_TUNING.seaLevel;
}

// ─── 街 ─────────────────────────────────────────────────────

export interface Town {
  x: number;
  y: number;
  /** 属するリージョン index (ry * 8 + rx) */
  region: number;
  name: string;
}

/** リージョン index → 街名。バイオーム/危険度の雰囲気に合わせた 64 個の固定名。
 *  街が生成されないリージョン (海主体) の名前は使われない。 */
export const TOWN_NAMES: readonly string[] = [
  'そらみの街', 'かぜまちの宿場', 'あさぎりの村', 'ひばりの丘', 'しらかばの里', 'こもれびの村', 'つばめの街', 'ゆうなぎの浜',
  'みなもの街', 'あおばの宿場', 'きりかぶの村', 'ほしぞらの丘', 'たきおとの里', 'いわかげの宿', 'なぎさの村', 'うみねこの湊',
  'このはの街', 'ふたばの村', 'せせらぎの里', 'やまびこの宿場', 'くもまの街', 'かげろうの村', 'しおさいの湊', 'いそかぜの浜',
  'わかくさの村', 'とんぼの原', 'かわせみの里', 'つきかげの街', 'おおたきの宿', 'けものみちの砦', 'あらいその湊', 'かもめの浜',
  'すずかぜの街', 'ななくさの村', 'こだまの杜', 'ゆきどけの里', 'いただきの関', 'たかねの砦', 'しんりんの宿', 'みさきの灯台',
  'はるかぜの村', 'あぜみちの里', 'どんぐりの杜', 'かすみの街', 'いしだたみの宿場', 'おにびの関', 'ふかもりの砦', 'しらなみの湊',
  'ひなたの村', 'むぎばたけの里', 'きつつきの杜', 'よあけの街', 'さかみちの宿', 'やまねこの砦', 'くらやみの関', 'はてしの灯台',
  'あかつきの村', 'いなほの里', 'ふくろうの杜', 'たそがれの街', 'いしきりの宿', 'おおわしの砦', 'まぼろしの関', 'さいはての湊',
];

// ─── 全域スキャン (街・橋・到達可能性) のメモ化 ─────────────

export interface WorldOverlay {
  towns: Town[];
  /** 橋のタイル座標 (スパンの全タイル) */
  bridgeTiles: { x: number; y: number }[];
  /** 橋スパン数 */
  bridgeSpans: number;
  /** 開始の街 (メイン大陸 = 最大到達成分の中の街) */
  spawn: Town;
  /** packed 座標 (y*W+x) → 'town' | 'bridge' */
  overlayMap: Map<number, 'town' | 'bridge'>;
  /** packed 座標 → Town (街画面用の O(1) 逆引き) */
  townMap: Map<number, Town>;
}

let cachedOverlay: WorldOverlay | null = null;

function computeTowns(): Town[] {
  const towns: Town[] = [];
  const r = WORLD_TUNING.townSearchRadius;
  for (let ry = 0; ry < REGIONS_PER_SIDE; ry++) {
    for (let rx = 0; rx < REGIONS_PER_SIDE; rx++) {
      const cx = rx * REGION_SIZE + REGION_SIZE / 2;
      const cy = ry * REGION_SIZE + REGION_SIZE / 2;
      let found: { x: number; y: number } | null = null;
      outer: for (let ring = 0; ring <= r; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const x = wrap(cx + dx);
            const y = wrap(cy + dy);
            const t = baseTerrainAt(x, y);
            if (t === 'plains' || t === 'grove') {
              found = { x, y };
              break outer;
            }
          }
        }
      }
      if (found) {
        const region = ry * REGIONS_PER_SIDE + rx;
        towns.push({ ...found, region, name: TOWN_NAMES[region] ?? `第${region}の街` });
      }
    }
  }
  return towns;
}

function computeBridges(): { tiles: { x: number; y: number }[]; spans: number } {
  const t = WORLD_TUNING;
  const tiles: { x: number; y: number }[] = [];
  const anchors: [number, number][] = [];
  const isPassableLand = (x: number, y: number) => {
    const b = baseTerrainAt(x, y);
    return b === 'plains' || b === 'grove' || b === 'forest';
  };
  const nearAnchor = (x: number, y: number) => {
    for (const [px, py] of anchors) {
      const ddx = Math.min(Math.abs(px - x), WORLD_SIZE - Math.abs(px - x));
      const ddy = Math.min(Math.abs(py - y), WORLD_SIZE - Math.abs(py - y));
      if (ddx + ddy < t.bridgeSpacing) return true;
    }
    return false;
  };
  /** 両端が「橋なしでも局所的に歩いて行き来できる」なら、その橋は海岸の
   *  切れ込みを跨ぐだけの飾りになる (初版は 20 スパン中 19 がこれで、
   *  オーナー報告 2026-07-17「発見した全ての橋が機能していない」の原因)。
   *  半径 localDetourRadius の陸上 BFS で回り込めるかを判定する。 */
  const locallyConnected = (ax: number, ay: number, bx: number, by: number): boolean => {
    const R = 20;
    const seen = new Set<number>([ay * WORLD_SIZE + ax]);
    const queue: [number, number][] = [[ax, ay]];
    while (queue.length > 0) {
      const [cx2, cy2] = queue.shift()!;
      if (cx2 === bx && cy2 === by) return true;
      for (const [dx2, dy2] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = wrap(cx2 + dx2);
        const ny = wrap(cy2 + dy2);
        const ddx = Math.min(Math.abs(nx - ax), WORLD_SIZE - Math.abs(nx - ax));
        const ddy = Math.min(Math.abs(ny - ay), WORLD_SIZE - Math.abs(ny - ay));
        if (ddx > R || ddy > R) continue;
        const k = ny * WORLD_SIZE + nx;
        if (seen.has(k) || !isPassableLand(nx, ny)) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
    return false;
  };
  const trySpan = (x: number, y: number, dx: number, dy: number) => {
    if (!isPassableLand(wrap(x - dx), wrap(y - dy))) return;
    const run: [number, number][] = [];
    let cx = x;
    let cy = y;
    for (let len = 0; len < t.bridgeMaxSpan; len++) {
      if (!isRiverAt(cx, cy)) break;
      run.push([cx, cy]);
      cx = wrap(cx + dx);
      cy = wrap(cy + dy);
    }
    if (run.length === 0 || run.length > t.bridgeMaxSpan) return;
    if (!isPassableLand(cx, cy)) return;
    const mid = run[Math.floor(run.length / 2)]!;
    if (nearAnchor(mid[0], mid[1])) return;
    // 回り込める切れ込みには架けない (本物の渡河点だけに架ける)
    if (locallyConnected(wrap(x - dx), wrap(y - dy), cx, cy)) return;
    anchors.push(mid);
    for (const [bx, by] of run) tiles.push({ x: bx, y: by });
  };
  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      if (!isRiverAt(x, y)) continue;
      trySpan(x, y, 1, 0);
      trySpan(x, y, 0, 1);
    }
  }
  return { tiles, spans: anchors.length };
}

/** 生成結果の永続形 (world-data.ts に埋め込む JSON 互換データ)。 */
export interface WorldOverlayData {
  towns: Town[];
  bridgeTiles: { x: number; y: number }[];
  bridgeSpans: number;
  spawn: Town;
}

/**
 * 全域スキャンで街・橋・spawn を**計算**する (~1-2 秒)。
 * ランタイムでは呼ばない — scripts/gen-world-data.ts がこれを実行して
 * world-data.ts に静的データとして埋め込み、テストが「再生成 = 埋め込みデータ」を
 * 検証する (生成アルゴリズム/チューニング変更の検知)。
 * ランタイムが毎回スキャンしない理由: Web は初回 terrainAt が数秒ブロックし、
 * CF Worker/DO はハイバネーション毎の再計算 + CPU 時間制限に抵触するため。
 */
export function computeWorldOverlay(): WorldOverlayData {
  const towns = computeTowns();
  const { tiles: bridgeTiles, spans: bridgeSpans } = computeBridges();
  const overlayMap = new Map<number, 'town' | 'bridge'>();
  for (const b of bridgeTiles) overlayMap.set(b.y * WORLD_SIZE + b.x, 'bridge');
  for (const tn of towns) overlayMap.set(tn.y * WORLD_SIZE + tn.x, 'town');
  if (towns.length === 0) throw new Error('world generation produced no towns (tuning broken?)');

  // spawn: 最大の徒歩到達成分に属する街のうち、リージョン index 最小のもの。
  // (成分判定は「どの街から始めても同じ成分の街集合が最大」で近似せず、実際に
  //  flood fill で成分サイズを測って決める)
  const componentOf = new Int32Array(WORLD_SIZE * WORLD_SIZE).fill(-1);
  const componentSizes: number[] = [];
  const terrainQuick = (x: number, y: number): Terrain => {
    const o = overlayMap.get(y * WORLD_SIZE + x);
    return o ?? baseTerrainAt(x, y);
  };
  for (const tn of towns) {
    const start = tn.y * WORLD_SIZE + tn.x;
    if (componentOf[start] !== -1) continue;
    const id = componentSizes.length;
    let size = 0;
    const stack = [start];
    componentOf[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % WORLD_SIZE;
      const y = (i - x) / WORLD_SIZE;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = wrap(x + dx);
        const ny = wrap(y + dy);
        const ni = ny * WORLD_SIZE + nx;
        if (componentOf[ni] !== -1) continue;
        if (!isWalkable(terrainQuick(nx, ny))) continue;
        componentOf[ni] = id;
        stack.push(ni);
      }
    }
    componentSizes.push(size);
  }
  let bestComponent = 0;
  for (let i = 1; i < componentSizes.length; i++) {
    if (componentSizes[i]! > componentSizes[bestComponent]!) bestComponent = i;
  }
  // spawn: メイン大陸の街のうち「最初の視界が最も豊か」なもの (単調な大平原スタートを
  // 避ける。オーナー指摘 2026-07-17)。**実際のビューポートと同じ ±8 タイル**の窓で:
  //  - 通行不能 (水/山/池) が 30% 以上の街は除外 (海際・山際すぎて歩き出しが詰まる)
  //  - 歩ける地形 (平地/林/森) のうち 8% 以上を占める種類が 2 つ未満の街も除外 (単調)
  //  - スコア = 地形種類数 ×100 + 見どころ率 (森/水/山/池、上限 40)
  // 同点はリージョン index 最小で決定的にタイブレーク。
  const mainTowns = towns.filter((tn) => componentOf[tn.y * WORLD_SIZE + tn.x] === bestComponent);
  if (mainTowns.length === 0) throw new Error('no spawn town found in largest component');
  const spawnScore = (tn: Town): number => {
    const counts = new Map<Terrain, number>();
    let total = 0;
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const t = baseTerrainAt(tn.x + dx, tn.y + dy);
        counts.set(t, (counts.get(t) ?? 0) + 1);
        total++;
      }
    }
    const frac = (k: Terrain) => (counts.get(k) ?? 0) / total;
    const impassable = frac('water') + frac('mountain') + frac('pond');
    if (impassable >= 0.3) return -1;
    const walkKinds = (['plains', 'grove', 'forest'] as const).filter((k) => frac(k) > 0.08).length;
    if (walkKinds < 2) return -1;
    const scenicPct = (frac('forest') + frac('water') + frac('mountain') + frac('pond')) * 100;
    return counts.size * 100 + Math.min(scenicPct, 40);
  };
  let spawn: Town | null = null;
  let bestScore = -1;
  for (const tn of mainTowns) {
    const s = spawnScore(tn);
    if (s > bestScore || (s === bestScore && spawn !== null && tn.region < spawn.region)) {
      spawn = tn;
      bestScore = s;
    }
  }
  // 全滅 (すべて除外) の保険: 先頭の街
  if (!spawn) spawn = mainTowns[0]!;

  return { towns, bridgeTiles, bridgeSpans, spawn };
}

/**
 * ランタイム用の全域スキャン結果 (街・橋・spawn)。**静的データ (world-data.ts) から
 * Map を組むだけ**なので即座 (初回 <1ms、以後メモ化)。
 */
export function worldOverlay(): WorldOverlay {
  if (cachedOverlay) return cachedOverlay;
  const { towns, bridgeTiles, bridgeSpans, spawn } = WORLD_DATA;
  const overlayMap = new Map<number, 'town' | 'bridge'>();
  const townMap = new Map<number, Town>();
  for (const b of bridgeTiles) overlayMap.set(b.y * WORLD_SIZE + b.x, 'bridge');
  for (const tn of towns) {
    overlayMap.set(tn.y * WORLD_SIZE + tn.x, 'town');
    townMap.set(tn.y * WORLD_SIZE + tn.x, tn);
  }
  cachedOverlay = { towns: [...towns], bridgeTiles: [...bridgeTiles], bridgeSpans, spawn, overlayMap, townMap };
  return cachedOverlay;
}

/** 最終的な地形 (街・橋の上書き込み)。worldOverlay() を内部で使う。 */
export function terrainAt(xIn: number, yIn: number): Terrain {
  const x = wrap(xIn);
  const y = wrap(yIn);
  const o = worldOverlay().overlayMap.get(y * WORLD_SIZE + x);
  return o ?? baseTerrainAt(x, y);
}

/** その座標が街なら Town を返す (街画面・店のヘッダ用)。 */
export function townAt(x: number, y: number): Town | null {
  return worldOverlay().townMap.get(wrap(y) * WORLD_SIZE + wrap(x)) ?? null;
}

/** 地形別の遭遇率 (通行不能地形は 0)。 */
export function encounterRateFor(t: Terrain): number {
  const r = WORLD_TUNING.encounterRate as Partial<Record<Terrain, number>>;
  return r[t] ?? 0;
}

/** 地形別のアイテム発見率 (通行不能地形は 0)。 */
export function itemRateFor(t: Terrain): number {
  const r = WORLD_TUNING.itemRate as Partial<Record<Terrain, number>>;
  return r[t] ?? 0;
}

// ─── リージョン・危険度 ─────────────────────────────────────

export function regionOf(x: number, y: number): number {
  const rx = Math.floor(wrap(x) / REGION_SIZE);
  const ry = Math.floor(wrap(y) / REGION_SIZE);
  return ry * REGIONS_PER_SIDE + rx;
}

/**
 * リージョンの危険度 (0..3)。spawn リージョンからのトーラス距離 + ノイズで決まり、
 * 遭遇モンスターの tier に対応する (0-1 → tier1 中心, 2 → tier2, 3 → tier3)。
 */
export function regionDanger(region: number): number {
  const spawnRegion = worldOverlay().spawn.region;
  const rx = region % REGIONS_PER_SIDE;
  const ry = Math.floor(region / REGIONS_PER_SIDE);
  const sx = spawnRegion % REGIONS_PER_SIDE;
  const sy = Math.floor(spawnRegion / REGIONS_PER_SIDE);
  const dx = Math.min(Math.abs(rx - sx), REGIONS_PER_SIDE - Math.abs(rx - sx));
  const dy = Math.min(Math.abs(ry - sy), REGIONS_PER_SIDE - Math.abs(ry - sy));
  const dist = dx + dy; // 0..8
  const jitter = hash2(rx, ry, WORLD_SEED * 19 + 23); // 0..1
  const raw = dist / 2.5 + jitter * 0.9;
  return Math.max(0, Math.min(3, Math.floor(raw)));
}
