import { WORLD_SIZE, wrap, type WorldPart } from '@aozoraquest/core';
import { appendBiomePart } from './biome-parts';

/** ほむらの街 (region 26) の座標 (#690)。砂漠はここを中心に入れる。 */
export const HOMURA_TOWN = { x: 320, y: 448 } as const;
/** 砂漠の横・縦の半径 (マス)。輪郭は角度ごとに ±2 割ほど揺らす。 */
const RADIUS_X = 16;
const RADIUS_Y = 12;
/** 砂漠に置き換えてよい地形。町・水・池・山・橋・雪は触らない。 */
const REPLACEABLE = new Set(['plains', 'grove', 'forest']);
const DESERT: WorldPart = { terrain: 'desert', name: '砂漠' };

function inDesert(dx: number, dy: number): boolean {
  const angle = Math.atan2(dy, dx);
  const scale = 1 + 0.12 * Math.sin(3 * angle + 1) + 0.08 * Math.sin(5 * angle + 2);
  return (dx / RADIUS_X) ** 2 + (dy / RADIUS_Y) ** 2 <= scale * scale;
}

const walkablePart = (part: WorldPart | undefined): boolean => part?.walkable !== false;

/**
 * **ほむらの街のまわりを砂漠にする** (下書きへの挿入。保存は呼び出し側の明示操作)。
 *
 * `tiles` をその場で書き換え、使う parts を返す。置き換えるのは通行できる
 * 平原・林・森だけなので、町への徒歩経路は変わらない。対象が無ければ何も変えない。
 */
export function insertHomuraDesert(
  parts: readonly WorldPart[],
  tiles: Uint8Array,
  towns: readonly { x: number; y: number }[],
): { parts: WorldPart[]; changed: number } {
  const center = HOMURA_TOWN.y * WORLD_SIZE + HOMURA_TOWN.x;
  if (parts[tiles[center]!]?.terrain !== 'town') {
    throw new Error('ほむらの街 (320, 448) が地図上で町になっていないため、砂漠を入れられません');
  }
  const townKeys = new Set(towns.map((t) => wrap(t.y) * WORLD_SIZE + wrap(t.x)));
  const targets: number[] = [];
  for (let dy = -RADIUS_Y * 2; dy <= RADIUS_Y * 2; dy++) {
    for (let dx = -RADIUS_X * 2; dx <= RADIUS_X * 2; dx++) {
      if (!inDesert(dx, dy)) continue;
      const k = wrap(HOMURA_TOWN.y + dy) * WORLD_SIZE + wrap(HOMURA_TOWN.x + dx);
      const part = parts[tiles[k]!];
      if (townKeys.has(k) || !part || !REPLACEABLE.has(part.terrain) || !walkablePart(part)) continue;
      targets.push(k);
    }
  }
  if (targets.length === 0) return { parts: [...parts], changed: 0 };
  let index = parts.findIndex((p) => p.terrain === 'desert' && walkablePart(p));
  let next = [...parts];
  if (index < 0) {
    next = appendBiomePart(parts, tiles, DESERT, true);
    index = next.length - 1;
  }
  for (const k of targets) tiles[k] = index;
  return { parts: next, changed: targets.length };
}
