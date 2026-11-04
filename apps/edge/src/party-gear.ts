/**
 * 仲間の装備 (D-PARTY-004 §6)。`POST /api/party/gear {id, gear}` と、1 個は 1 人だけ の確かめ。
 * - 主人公の /api/world/gear と同じ sanitizeGear を通し (持っている個体だけ・両手武器と盾)、職 (canEquip / jobOnly)・
 *   隣り合う属性 (D-ELEM-001 の adjacentArmorConflict)・人数 (core の overWorn) を見る。どこでも着がえられる (主人公と同じ)
 * - 着ている人数を数えるのは core の equippedCounts 1 か所。着る (主人公・仲間)・すてる・きたえる が wearersOf を使う
 */
import { adjacentArmorConflict, canEquip, EQUIPMENT_BY_ID, equippedCounts, GEAR_SLOTS, ownedCounts, partyDefsOf, recruitById, type GearSelection, type GearWearers } from '@aozoraquest/core';
import { readModifyWrite, sanitizeGear, type GameState, type OwnedPiece, type PartyState } from './game-state';
import { ResolverError, migrateInitState, type ResolverEnv } from './battle-resolver';

/** 主人公 ('hero') と仲間の装備。 */
export function wearersOf(state: Pick<GameState, 'gearSel' | 'party'>): GearWearers {
  return [{ who: 'hero', gear: state.gearSel }, ...Object.entries(state.party?.gear ?? {}).filter(([id]) => state.party?.ids.includes(id)).map(([who, gear]) => ({ who, gear }))];
}

/**
 * 着がえで 持っている数より多く着るぶんが増えたら 400 (その品は ほかの人が そうびしている)。
 * もとから超えている (品・強化値) は、増えないかぎり通す (超えた状態のまま 着がえ全部が止まらないように)。
 */
export function assertNotOverWorn(before: Pick<GameState, 'gearSel' | 'party'>, after: Pick<GameState, 'gearSel' | 'party'>, pieces: readonly OwnedPiece[]): void {
  const owned = ownedCounts(pieces);
  const was = equippedCounts(wearersOf(before));
  const grew = [...equippedCounts(wearersOf(after))].some(([k, n]) => n > Math.max(was.get(k) ?? 0, owned.get(k) ?? 0));
  if (grew) throw new ResolverError('その品は ほかの人が そうびしている', 400, 'worn_by_other');
}

export interface PartyGearResult { party: PartyState }

/** 仲間に着せる。gear は着る全部 (主人公の /api/world/gear と同じ。空の枠は はずす)。 */
export async function handlePartyGear(env: ResolverEnv, did: string, id: unknown, gear: unknown, now: number, ns: string): Promise<PartyGearResult> {
  if (typeof id !== 'string' || !gear || typeof gear !== 'object' || Array.isArray(gear)) throw new ResolverError('入力が不正', 400, 'bad_request');
  if (adjacentArmorConflict(gear as GearSelection)) throw new ResolverError('隣り合う属性の防具は一緒に着られない', 400, 'element_conflict');
  const after = await readModifyWrite(env, did, (cur) => {
    const party = cur.party;
    const ally = partyDefsOf(party, recruitById, 1).find((a) => a.id === id);
    if (!party || !ally) throw new ResolverError('その仲間は パーティに いない', 400, 'bad_request');
    const pieces = cur.pieces ?? [];
    const sel = sanitizeGear(gear as GearSelection, pieces);
    for (const slot of GEAR_SLOTS) {
      const p = sel[slot];
      const def = p ? EQUIPMENT_BY_ID[typeof p === 'string' ? p : p.id] : undefined;
      if (def && !canEquip(ally.archetype, def)) throw new ResolverError(`${ally.name}は ${def.name}を そうびできない`, 400, 'cannot_equip');
    }
    const nextGear = { ...party.gear };
    if (Object.keys(sel).length) nextGear[id] = sel; else delete nextGear[id];
    const { gear: _g, ...rest } = party;
    const next: GameState = { ...cur, party: { ...rest, ...(Object.keys(nextGear).length ? { gear: nextGear } : {}) } };
    assertNotOverWorn(cur, next, pieces);
    return next;
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return { party: after.party ?? { ids: [] } };
}
