/**
 * 装備中の記録 (docs/20 W6c)。
 *
 * `gear/self` レコードは **craft/forge レコードの rkey 参照** を書く。強化値は
 * 直書きしない — 集計 (loadCraftInventory) が再導出した個体の level を使う
 * (直書きを信用すると導出方式の意味が消える。docs/20 の W6c 契約)。
 * 参照先が無い / スロット不一致 / 装備不可の参照は解決時に黙って外れる
 * (合成で燃やした・転職した等の自然な失効)。
 */

import type { Agent } from '@atproto/api';
import { EQUIPMENT_BY_ID, canEquip, type Archetype, type EquipSlot, type GearSelection } from '@aozoraquest/core';
import { getRecord, putRecord } from './atproto';
import { COL } from './collections';
import type { CraftedPiece } from './crafting';

/** gear/self のレコード形 (rkey 参照)。 */
export interface GearRefs {
  weapon?: string;
  armor?: string;
  charm?: string;
}

const SLOTS: readonly EquipSlot[] = ['weapon', 'armor', 'charm'];

export async function loadGearRefs(agent: Agent, did: string): Promise<GearRefs> {
  const rec = await getRecord<Record<string, unknown>>(agent, did, COL.gear, 'self').catch(() => null);
  if (!rec) return {};
  const refs: GearRefs = {};
  for (const slot of SLOTS) {
    const v = rec[slot];
    if (typeof v === 'string' && v.length > 0) refs[slot] = v;
  }
  return refs;
}

export async function saveGearRefs(agent: Agent, refs: GearRefs): Promise<void> {
  await putRecord(agent, COL.gear, 'self', {
    ...(refs.weapon ? { weapon: refs.weapon } : {}),
    ...(refs.armor ? { armor: refs.armor } : {}),
    ...(refs.charm ? { charm: refs.charm } : {}),
    updatedAt: new Date().toISOString(),
  });
}

export interface ResolvedGear {
  /** 戦闘値に渡す形 (core の GearSelection) */
  selection: GearSelection;
  /** スロットごとの解決済み個体 (UI 表示用)。無効参照は undefined */
  pieces: Partial<Record<EquipSlot, CraftedPiece>>;
}

/**
 * rkey 参照を所持個体で解決する。無い参照・スロット不一致・装備不可は外す。
 * archetype が null (未診断) のときは全部外す (戦闘に入れないので実害なし)。
 */
export function resolveGear(refs: GearRefs, pieces: readonly CraftedPiece[], archetype: Archetype | null): ResolvedGear {
  const byRkey = new Map(pieces.map((p) => [p.rkey, p]));
  const selection: GearSelection = {};
  const resolved: ResolvedGear['pieces'] = {};
  if (!archetype) return { selection, pieces: resolved };
  for (const slot of SLOTS) {
    const rkey = refs[slot];
    if (!rkey) continue;
    const piece = byRkey.get(rkey);
    if (!piece) continue;
    const def = EQUIPMENT_BY_ID[piece.itemId];
    if (!def || def.slot !== slot || !canEquip(archetype, def)) continue;
    selection[slot] = { id: piece.itemId, level: piece.level };
    resolved[slot] = piece;
  }
  return { selection, pieces: resolved };
}

/** gear の読取 + 個体解決を一括で (me.tsx / trial 用の便宜関数)。 */
export async function loadResolvedGear(
  agent: Agent,
  did: string,
  pieces: readonly CraftedPiece[],
  archetype: Archetype | null,
): Promise<ResolvedGear> {
  const refs = await loadGearRefs(agent, did);
  return resolveGear(refs, pieces, archetype);
}
