import { describe, expect, it } from 'vitest';
import { BASE_PARTS, bundledWorldMapTiles, isWalkable, worldOverlay, WORLD_SIZE, wrap, type Terrain, type WorldPart } from '@aozoraquest/core';
import { HOMURA_TOWN, insertHomuraDesert } from './homura-desert';

const FUTABA = { x: 211, y: 340 };

/** ふたばの村から ほむらの街まで、parts の通行判定で歩いて行けるか (BFS)。 */
function reachable(tiles: Uint8Array, parts: readonly WorldPart[]): boolean {
  const walk = (i: number) => {
    const p = parts[tiles[i]!];
    return p ? (p.walkable ?? isWalkable(p.terrain as Terrain)) : false;
  };
  const goal = HOMURA_TOWN.y * WORLD_SIZE + HOMURA_TOWN.x;
  const seen = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
  const queue = [FUTABA.y * WORLD_SIZE + FUTABA.x];
  seen[queue[0]!] = 1;
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h]!;
    if (k === goal) return true;
    const x = k % WORLD_SIZE; const y = (k - x) / WORLD_SIZE;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = wrap(y + dy) * WORLD_SIZE + wrap(x + dx);
      if (!seen[n] && walk(n)) { seen[n] = 1; queue.push(n); }
    }
  }
  return false;
}

describe('ほむらの街の砂漠を入れる (#690)', () => {
  it('町名は region 26 が「ほむらの街」', () => {
    const town = worldOverlay().towns.find((t) => t.x === HOMURA_TOWN.x && t.y === HOMURA_TOWN.y);
    expect(town).toMatchObject({ region: 26, name: 'ほむらの街' });
  });

  it('平原・林・森だけを砂漠にし、町・水・山・橋は変えず、ふたばの村から歩いて行ける', async () => {
    const before = await bundledWorldMapTiles();
    const tiles = new Uint8Array(before);
    const parts = [...BASE_PARTS];
    const { parts: next, changed } = insertHomuraDesert(parts, tiles, worldOverlay().towns);
    expect(next).toHaveLength(BASE_PARTS.length + 1);
    expect(next.slice(0, BASE_PARTS.length)).toEqual(BASE_PARTS);
    const desert = next.length - 1;
    expect(next[desert]?.terrain).toBe('desert');
    expect(changed).toBeGreaterThan(300);
    let diff = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === before[i]) continue;
      diff++;
      expect(tiles[i]).toBe(desert);
      expect(['plains', 'grove', 'forest']).toContain(BASE_PARTS[before[i]!]!.terrain);
      const x = i % WORLD_SIZE; const y = (i - x) / WORLD_SIZE;
      expect(Math.abs(x - HOMURA_TOWN.x)).toBeLessThanOrEqual(32);
      expect(Math.abs(y - HOMURA_TOWN.y)).toBeLessThanOrEqual(24);
    }
    expect(diff).toBe(changed);
    expect(tiles[HOMURA_TOWN.y * WORLD_SIZE + HOMURA_TOWN.x]).toBe(BASE_PARTS.findIndex((p) => p.terrain === 'town'));
    expect(reachable(tiles, next)).toBe(true);
  });

  it('既存の砂漠パーツを再利用し、二度目は何も変えない', async () => {
    const tiles = await bundledWorldMapTiles();
    const parts: WorldPart[] = [...BASE_PARTS, { terrain: 'bridge', name: 'たての橋' }, { terrain: 'desert', name: '砂漠' }];
    const first = insertHomuraDesert(parts, tiles, worldOverlay().towns);
    expect(first.parts).toEqual(parts);
    expect(first.changed).toBeGreaterThan(0);
    const snapshot = new Uint8Array(tiles);
    const second = insertHomuraDesert(first.parts, tiles, worldOverlay().towns);
    expect(second).toEqual({ parts, changed: 0 });
    expect(tiles).toEqual(snapshot);
  });

  it('町が消された地図では何も変えずに理由を返す', async () => {
    const tiles = await bundledWorldMapTiles();
    tiles[HOMURA_TOWN.y * WORLD_SIZE + HOMURA_TOWN.x] = 0;
    const snapshot = new Uint8Array(tiles);
    expect(() => insertHomuraDesert(BASE_PARTS, tiles, worldOverlay().towns)).toThrow('町になっていない');
    expect(tiles).toEqual(snapshot);
  });
});
