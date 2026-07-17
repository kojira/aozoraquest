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
import { computeWorldOverlay, WORLD_SEED } from '../packages/core/src/world.js';

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
console.log(`wrote ${dest}: towns=${data.towns.length} bridgeSpans=${data.bridgeSpans} spawn=(${data.spawn.x},${data.spawn.y}) ${data.spawn.name}`);
