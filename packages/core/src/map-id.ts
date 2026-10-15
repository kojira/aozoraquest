/**
 * **フィールドを表す mapId** (#424)。位置は `(mapId, x, y)` の 3 つ組で、
 * 省略 = フィールド。内部マップはこれ以外の id を持つ。
 *
 * interior.ts と npc-data.ts の両方が使うので、どちらにも属さない場所に置く
 * (npc-data → interior → world → npc-data の循環 import を作らない)。
 */
export const WORLD_MAP_ID = 'world';
