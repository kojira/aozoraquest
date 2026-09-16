import type { TileArt } from '@aozoraquest/core';

// Art only: existing plains-type custom parts, not new desert/snow terrain definitions.
export const sandArt: TileArt = {
  size: 16, palette: ['#dabc78', '#eedba0', '#b58e50'],
  pixels: Uint8Array.from({ length: 256 }, (_, i) => i % 19 === 0 ? 2 : i % 7 === 0 ? 1 : 0),
};
export const snowArt: TileArt = {
  size: 32, palette: ['#edf5fc', '#bdcfdf', '#ffffff'],
  pixels: Uint8Array.from({ length: 1024 }, (_, i) => i % 23 === 0 ? 1 : i % 5 === 0 ? 2 : 0),
};
