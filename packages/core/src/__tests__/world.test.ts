import { describe, it, expect } from 'vitest';
import {
  WORLD_SIZE,
  REGION_COUNT,
  REGIONS_PER_SIDE,
  TOWN_NAMES,
  baseTerrainAt,
  terrainAt,
  elevationAt,
  isWalkable,
  regionDanger,
  regionOf,
  worldOverlay,
  wrap,
  type Terrain,
} from '../world.js';

describe('wrap / トーラス', () => {
  it('座標は mod 1024 で丸まる', () => {
    expect(wrap(-1)).toBe(WORLD_SIZE - 1);
    expect(wrap(WORLD_SIZE)).toBe(0);
    expect(wrap(WORLD_SIZE + 5)).toBe(5);
  });
  it('端の地形は逆側と連続する (継ぎ目なし = 同座標に丸めて同値)', () => {
    for (let i = 0; i < 50; i++) {
      const y = i * 20;
      expect(baseTerrainAt(-1, y)).toBe(baseTerrainAt(WORLD_SIZE - 1, y));
      expect(baseTerrainAt(WORLD_SIZE, y)).toBe(baseTerrainAt(0, y));
      expect(baseTerrainAt(y, -1)).toBe(baseTerrainAt(y, WORLD_SIZE - 1));
    }
  });
  it('決定的 (同じ座標は常に同じ地形)', () => {
    for (const [x, y] of [[0, 0], [512, 512], [123, 987], [1000, 3]]) {
      expect(baseTerrainAt(x!, y!)).toBe(baseTerrainAt(x!, y!));
    }
  });
});

describe('地形の分布 (シード固定の世界を統計で固定)', () => {
  // 32x32 間引きサンプリング (1024 点) で分布を確認する。
  // 閾値やシードを変えて世界が別物になったらこのテストが落ちる (意図的な保険)。
  const counts: Record<string, number> = {};
  let total = 0;
  for (let y = 0; y < WORLD_SIZE; y += 32) {
    for (let x = 0; x < WORLD_SIZE; x += 32) {
      const t = baseTerrainAt(x, y);
      counts[t] = (counts[t] ?? 0) + 1;
      total++;
    }
  }
  const pct = (t: string) => ((counts[t] ?? 0) / total) * 100;

  it('陸地率はおおむね 55-70%', () => {
    const land = pct('plains') + pct('grove') + pct('forest') + pct('pond') + pct('mountain');
    expect(land).toBeGreaterThan(55);
    expect(land).toBeLessThan(70);
  });
  it('森は 8% 以上ある (遭遇の主戦場)', () => {
    expect(pct('forest')).toBeGreaterThan(8);
  });
  it('山は 5-15% (通行不能の障害物として存在感がある)', () => {
    expect(pct('mountain')).toBeGreaterThan(5);
    expect(pct('mountain')).toBeLessThan(15);
  });
});

describe('worldOverlay (街・橋・spawn)', () => {
  const overlay = worldOverlay(); // 初回フルスキャン (テスト全体で 1 回)

  it('街は 40 以上生成され、全て歩行可能な場所にある', () => {
    expect(overlay.towns.length).toBeGreaterThanOrEqual(40);
    expect(overlay.towns.length).toBeLessThanOrEqual(REGION_COUNT);
    for (const t of overlay.towns) {
      expect(terrainAt(t.x, t.y)).toBe('town');
    }
  });

  it('街の名前はリージョン対応で一意', () => {
    expect(TOWN_NAMES).toHaveLength(REGION_COUNT);
    expect(new Set(TOWN_NAMES).size).toBe(REGION_COUNT);
    for (const n of TOWN_NAMES) expect(n).toBe(n.trim()); // 前後空白の混入防止
    const names = overlay.towns.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of overlay.towns) {
      expect(t.name).toBe(TOWN_NAMES[t.region]);
    }
  });

  it('リージョンごとの街は最大 1 つ', () => {
    const regions = overlay.towns.map((t) => t.region);
    expect(new Set(regions).size).toBe(regions.length);
  });

  it('橋は 15 本以上あり、全タイルが川 (海ではない) の上', () => {
    expect(overlay.bridgeSpans).toBeGreaterThanOrEqual(15);
    for (const b of overlay.bridgeTiles) {
      expect(terrainAt(b.x, b.y)).toBe('bridge');
      // 橋の下は海面より高い (= 川)
      expect(elevationAt(b.x, b.y)).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('spawn はメイン大陸の街', () => {
    expect(overlay.towns.some((t) => t.x === overlay.spawn.x && t.y === overlay.spawn.y)).toBe(true);
  });
});

describe('到達可能性 (docs/19 §1 の保証)', () => {
  it('spawn から徒歩+橋で歩行可能タイルの 95% 以上に到達できる', () => {
    const overlay = worldOverlay();
    const N = WORLD_SIZE;
    const seen = new Uint8Array(N * N);
    const start = overlay.spawn.y * N + overlay.spawn.x;
    seen[start] = 1;
    const stack = [start];
    let reachable = 0;
    while (stack.length) {
      const i = stack.pop()!;
      reachable++;
      const x = i % N;
      const y = (i - x) / N;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = wrap(x + dx);
        const ny = wrap(y + dy);
        const ni = ny * N + nx;
        if (seen[ni]) continue;
        if (!isWalkable(terrainAt(nx, ny))) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    let walkableTotal = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (isWalkable(terrainAt(x, y))) walkableTotal++;
      }
    }
    const ratio = reachable / walkableTotal;
    expect(ratio).toBeGreaterThanOrEqual(0.95);
    // 街の 8 割以上に徒歩到達できる (残りは船・飛行船の後期コンテンツ)
    let reachableTowns = 0;
    for (const t of overlay.towns) if (seen[t.y * N + t.x]) reachableTowns++;
    expect(reachableTowns / overlay.towns.length).toBeGreaterThanOrEqual(0.8);
  }, 60_000);
});

describe('リージョン・危険度', () => {
  it('regionOf は 0..63', () => {
    expect(regionOf(0, 0)).toBe(0);
    expect(regionOf(WORLD_SIZE - 1, WORLD_SIZE - 1)).toBe(REGION_COUNT - 1);
    expect(regionOf(130, 0)).toBe(1);
    expect(regionOf(0, 130)).toBe(REGIONS_PER_SIDE);
  });
  it('spawn リージョンの危険度は低く、全リージョンで 0..3', () => {
    const overlay = worldOverlay();
    expect(regionDanger(overlay.spawn.region)).toBeLessThanOrEqual(1);
    const seen = new Set<number>();
    for (let r = 0; r < REGION_COUNT; r++) {
      const d = regionDanger(r);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(3);
      seen.add(d);
    }
    // 世界に難度の勾配がある (少なくとも 3 段階)
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

describe('terrainAt の網羅性', () => {
  it('全 8 地形が世界に存在する', () => {
    const overlay = worldOverlay();
    const found = new Set<Terrain>();
    for (let y = 0; y < WORLD_SIZE; y += 16) {
      for (let x = 0; x < WORLD_SIZE; x += 16) {
        found.add(terrainAt(x, y));
      }
    }
    found.add(terrainAt(overlay.towns[0]!.x, overlay.towns[0]!.y));
    found.add(terrainAt(overlay.bridgeTiles[0]!.x, overlay.bridgeTiles[0]!.y));
    for (const t of ['plains', 'grove', 'forest', 'pond', 'water', 'mountain', 'town', 'bridge'] as const) {
      expect(found.has(t)).toBe(true);
    }
  });
});
