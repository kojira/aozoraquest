import { interiorById, interiorPartAt, type NpcDef } from '@aozoraquest/core';

/** NPC データの guildReception で受付を決める (Refs #718)。立っているマスが扉になってから有効化
 *  (古い PDS / 地形が揃う前は従来の NPC のまま)。 */
export function isFutabaGuild(npc: NpcDef): boolean {
  if (npc.guildReception !== true || !npc.mapId) return false;
  const map = interiorById(npc.mapId);
  return !!map && map.parts?.[interiorPartAt(map, npc.x, npc.y) ?? -1]?.terrain === 'door';
}
