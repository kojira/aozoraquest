import { BASE_PARTS, PALETTE_MAX, partKey, tileArtTerrains, type InteriorMap, type WorldPart } from '@aozoraquest/core';

/** Keep legacy shared art/terrain namespaces unchanged; conversion is an explicit editor action. */
export function interiorBiomeParts(map: InteriorMap, shared: readonly WorldPart[]): WorldPart[] {
  if (map.parts) return [...map.parts];
  const customArt = new Set(tileArtTerrains());
  if (map.tiles.some((index) => index >= BASE_PARTS.length)
    || BASE_PARTS.some((part, index) => (shared[index]?.terrain ?? part.terrain) !== part.terrain || customArt.has(partKey(index)))) {
    throw new Error('このマップは共有パーツを使用しているため、絵や通行を変えずに新しい地形を追加する対応が必要です。既存の編集と保存はそのまま使えます');
  }
  return BASE_PARTS.map((part, index) => ({ ...part, ...shared[index] }));
}

export function appendBiomePart(parts: readonly WorldPart[], tiles: Uint8Array, biome: WorldPart, field: boolean): WorldPart[] {
  if (parts.length >= PALETTE_MAX) throw new Error('パーツは256種類までです');
  // A dangling tile/art index is not a free slot: assigning it would change existing content.
  if (tiles.includes(parts.length) || (field && tileArtTerrains().includes(partKey(parts.length)))) {
    throw new Error('追加先の番号が既存の地図や絵で使われています。内容を変えないため追加できません');
  }
  return [...parts, { ...biome }];
}
