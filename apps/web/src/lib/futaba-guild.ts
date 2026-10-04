import { STARTER_TOWN_GUILD, STARTER_TOWN_ID, interiorById, interiorPartAt, type NpcDef } from '@aozoraquest/core';

/** 古いPDSでは従来のNPCを保つ。保存済み扉位置/地形が揃ってからギルドを有効化。 */
export function isFutabaGuild(npc: NpcDef): boolean {
  const village = interiorById(STARTER_TOWN_ID);
  return npc.id === 'futaba-bluesky' && npc.mapId === STARTER_TOWN_ID
    && npc.x === STARTER_TOWN_GUILD.x && npc.y === STARTER_TOWN_GUILD.y
    && !!village && village.parts?.[interiorPartAt(village, npc.x, npc.y) ?? -1]?.terrain === 'door';
}
