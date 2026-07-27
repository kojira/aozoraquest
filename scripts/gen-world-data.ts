/**
 * あおぞらワールドの静的データ生成器 (docs/19-overworld.md)。
 *
 * packages/core/src/world.ts の computeWorldOverlay() (全域スキャン ~1-2 秒) を実行し、
 * 結果 (街・橋・spawn) を packages/core/src/world-data.ts に埋め込む。ランタイム
 * (Web / CF Worker) はスキャンせず静的データを読むだけになる。
 *
 * 実行: pnpm gen:world  (生成アルゴリズムや WORLD_TUNING を変えたら再実行する。
 * 再実行し忘れは world.test.ts の「再生成一致」テストが検知する)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { computeWorldOverlay, WORLD_SEED, WORLD_SIZE, baseTerrainAt } from '../packages/core/src/world.js';
import { BASE_PALETTE } from '../packages/core/src/world-map.js';

const data = computeWorldOverlay();

const out = `/**
 * あおぞらワールドの静的データ (自動生成 — 手で編集しない)。
 *
 * 生成: \`pnpm gen:world\` (scripts/gen-world-data.ts が computeWorldOverlay() を実行)。
 * WORLD_SEED=${WORLD_SEED} の全域スキャン結果 (街 ${data.towns.length} / 橋 ${data.bridgeSpans} スパン)。
 * world.test.ts が「再生成 = 本データ」を検証する (アルゴリズム変更の検知)。
 */
import type { WorldOverlayData } from './world.js';

export const WORLD_DATA: WorldOverlayData = ${JSON.stringify(data, null, 2)};
`;

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '../packages/core/src/world-data.ts');
writeFileSync(dest, out);

// ─── 地形の地図 (1 タイル 1 バイト) ───────────────────────────
//
// ノイズ生成の結果をそのまま画素として書き出す。**見た目は 1 ピクセルも変わらない**が、
// ランタイムは全域スキャン (3.3 秒) が不要になり、terrainAt が配列参照になって
// 約 327 倍速くなる。エディタ (#421) はこの画素を編集する。
const idx = new Map(BASE_PALETTE.map((t, i) => [t, i] as const));
const tiles = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
for (let y = 0; y < WORLD_SIZE; y++) {
  for (let x = 0; x < WORLD_SIZE; x++) tiles[y * WORLD_SIZE + x] = idx.get(baseTerrainAt(x, y)) ?? 0;
}
const gz = gzipSync(Buffer.from(tiles), { level: 9 });
const rawKb = (tiles.length / 1024).toFixed(0);
const gzKb = (gz.length / 1024).toFixed(1);
const mapLines = [
  '/**',
  ' * あおぞらワールドの地形の地図 (自動生成 — 手で編集しない)。',
  ' *',
  ' * 生成: `pnpm gen:world`。1 タイル 1 バイトのパレット索引を gzip して base64 にしたもの。',
  ` * 生 ${rawKb} KB → gzip ${gzKb} KB。`,
  ' * **中身はノイズ生成そのまま**なので、読み込んでも見た目は変わらない。',
  ' * 読み込むと terrainAt が配列参照になり、全域スキャン (3.3 秒) が不要になる。',
  ' */',
  `export const WORLD_MAP_GZ_BASE64 = '${gz.toString('base64')}';`,
  '',
].join('\n');
const mapDest = path.join(path.dirname(fileURLToPath(import.meta.url)), '../packages/core/src/world-map-data.ts');
writeFileSync(mapDest, mapLines);
console.log(`wrote ${mapDest}: raw=${rawKb}KB gzip=${gzKb}KB`);
console.log(`wrote ${dest}: towns=${data.towns.length} bridgeSpans=${data.bridgeSpans} spawn=(${data.spawn.x},${data.spawn.y}) ${data.spawn.name}`);
