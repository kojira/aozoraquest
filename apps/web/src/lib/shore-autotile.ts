import { bundledTileArtFor, partKey, tileArtTerrains, type TileArt } from '@aozoraquest/core';

/** Clockwise cardinal bits, then diagonals NE/SE/SW/NW. Set means connected water. */
export const SHORE_NEIGHBORS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
const water = (t: string | undefined) => t === 'water' || t === 'pond' || t === 'bridge';

/** Missing cells are the continuation of water, not an invented bank at an interior's edge. */
export function shoreMaskAt(x: number, y: number, terrainAt: (x: number, y: number) => string | undefined): number {
  let mask = 0;
  SHORE_NEIGHBORS.forEach(([dx, dy], i) => {
    const t = terrainAt(x + dx, y + dy);
    if (t === undefined || water(t)) mask |= 1 << i;
  });
  // A diagonal matters only when BOTH bordering cardinals connect (47 unique shapes).
  for (let i = 0; i < 4; i++) if (!(mask & (1 << i)) || !(mask & (1 << ((i + 1) % 4)))) mask &= ~(1 << (i + 4));
  return mask;
}

/** Only unregistered defaults opt in; explicitly saving even unchanged art keeps that art. */
export function usesStandardShore(terrain: string, index?: number): boolean {
  if (terrain !== 'water' && terrain !== 'pond') return false;
  const custom = tileArtTerrains();
  return !custom.includes(terrain) && (index === undefined || !custom.includes(partKey(index)));
}

// Original 8x8 NW quarter artwork: ground window (g/e), foam, shallows, water.
// Rotations/reflections compose straight banks, bays, capes and narrow channels.
const STRAIGHT = ['gggggggg', 'eeeeeeee', 'ffffffff', 'ssssssss', '........', '........', '........', '........'];
const ROUND_WATER = ['gggggggg', 'gggggeee', 'gggeefff', 'ggeffsss', 'geffss..', 'gefss...', 'gefs....', 'gefs....'];
const ROUND_LAND = ['gefs....', 'efs.....', 'fs......', 's.......', '........', '........', '........', '........'];
const EMPTY = Array<string>(8).fill('........');
const cache = new Map<number, { art: TileArt; grounds: { neighbor: number; path: string }[] }>();

/** 16x16 art, kept out of persistence. The water texture/palette stays in the existing art family. */
function shoreLayers(mask: number) {
  const hit = cache.get(mask);
  if (hit) return hit;
  const base = bundledTileArtFor('water')!;
  const palette = [...base.palette, '', '#b8d9f2', '#7db8e8'];
  const ink: Record<string, number> = { g: base.palette.length, e: base.palette.length, f: base.palette.length + 1, s: base.palette.length + 2 };
  const paths = new Map<number, string>();
  const pixels = new Uint8Array(base.pixels);
  // NW, NE, SE, SW: each quarter is mirrored back to the NW template.
  for (const [qx, qy, vertical, horizontal, diagonal] of [[0, 0, 0, 3, 7], [1, 0, 0, 1, 4], [1, 1, 2, 1, 5], [0, 1, 2, 3, 6]] as const) {
    const v = !!(mask & (1 << vertical)), h = !!(mask & (1 << horizontal));
    const pattern = !v && !h ? ROUND_WATER : !v || !h ? STRAIGHT : mask & (1 << diagonal) ? EMPTY : ROUND_LAND;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const c = !h && v ? pattern[x]![y]! : pattern[y]![x]!;
      if (c === '.') continue;
      const px = qx ? 15 - x : x, py = qy ? 15 - y : y;
      pixels[py * 16 + px] = ink[c]!;
      if (c === 'g' || c === 'e') {
        // Nearest land edge; vertical wins ties. A concave corner uses the diagonal.
        const neighbor = !v && !h ? (y <= x ? vertical : horizontal) : !v ? vertical : !h ? horizontal : diagonal;
        paths.set(neighbor, (paths.get(neighbor) ?? '') + `M${px * 2},${py * 2}h2v2h-2z`);
      }
    }
  }
  const art: TileArt = { size: 16, palette, pixels };
  const layers = { art, grounds: [...paths].map(([neighbor, path]) => ({ neighbor, path })) };
  cache.set(mask, layers);
  return layers;
}

/** Transparent bank windows preserve the neighbor's original palette and pixel resolution. */
export const shoreArt = (mask: number): TileArt => shoreLayers(mask).art;
export const shoreGrounds = (mask: number) => shoreLayers(mask).grounds;

/** Include the actual land identities, not just water connectivity, in a rendered definition. */
export function shoreGroundKey(mask: number, x: number, y: number, keyAt: (x: number, y: number) => string): string {
  return shoreGrounds(mask).map(({ neighbor }) => {
    const [dx, dy] = SHORE_NEIGHBORS[neighbor]!;
    return `${neighbor}:${keyAt(x + dx, y + dy)}`;
  }).join('_');
}
