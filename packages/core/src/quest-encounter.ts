/**
 * **受注中の討伐依頼の敵を、依頼の地方で出やすくする** (D-EARLY-001)。
 *
 * ほむらの「ねっぷうの キノコ」(しろヒカリダケ 5 体) は、tier1 の 9 種から一様に引くと
 * 5 体まで平均 42 戦かかり、通しプレイで 14 戦 0 体だった (オーナー「最初に心が折れる候補」)。
 * 特定の依頼・敵の特例にせず、**すべての討伐依頼**に同じ規則を当てる:
 * 依頼を出した人の街と同じリージョンのフィールドで、その敵の重みを上げる (summonMonster の focus)。
 * 遭遇は今までどおり edge が封印し、seed から決定的。レア・逃げる敵・ストーリー専用は変えない。
 */
import { gameQuestById } from './quest-data.js';
import { allNpcs, type NpcDef } from './npc-data.js';
import { interiorById } from './interior.js';
import { regionOf, tierForRegion } from './world.js';
import { WORLD_MAP_ID } from './map-id.js';

/**
 * NPC のいる街のフィールドの座標。フィールドの NPC はその座標、内部マップの NPC は
 * なんでも屋の街 (shop.town) か、フィールドへの出口 (exitTo)。どちらも無い内部マップは undefined。
 */
export function npcFieldPosition(npc: Pick<NpcDef, 'mapId' | 'x' | 'y'>): { x: number; y: number } | undefined {
  if (!npc.mapId || npc.mapId === WORLD_MAP_ID) return { x: npc.x, y: npc.y };
  const map = interiorById(npc.mapId);
  if (!map) return undefined;
  const at = map.shop?.town ?? (map.exitTo?.mapId === WORLD_MAP_ID ? map.exitTo : undefined);
  return at ? { x: at.x, y: at.y } : undefined;
}

/** NPC のいる街の tier (ギルドの候補の Lv・画面の「おすすめ」)。街が分からなければ 1。 */
export function npcTownTier(npc: Pick<NpcDef, 'mapId' | 'x' | 'y'>): number {
  const at = npcFieldPosition(npc);
  return at ? tierForRegion(regionOf(at.x, at.y)) : 1;
}

/** このリージョンで出やすくする敵 id。受注中で、まだ数がそろっていない討伐依頼のうち、依頼主の街がこのリージョンにあるもの。 */
export function questEncounterFocus(activeQuests: readonly { id: string; progress: number }[], region: number): string[] {
  const out: string[] = [];
  for (const q of activeQuests) {
    const def = gameQuestById(q.id);
    const o = def?.objective;
    if (!def || o?.kind !== 'defeat' || q.progress >= o.count || out.includes(o.monsterId)) continue;
    const npc = allNpcs().find((n) => n.id === def.npcId);
    const at = npc ? npcFieldPosition(npc) : undefined;
    if (at && regionOf(at.x, at.y) === region) out.push(o.monsterId);
  }
  return out;
}
