import { gearKey, type GearSelection } from '@aozoraquest/core';
import type { GearRefs } from './gear';
import type { CraftedPiece } from './crafting';

/** そうびの「だれの？」(D-PARTY-004 §6)。主人公は 'hero'、仲間は id。 */
export interface GearWearer { who: string; name: string; gear: GearSelection }

/**
 * ほかの人が着ている個体 (rkey → 着ている人の名前)。仲間の装備は (品・強化値) で持つので、
 * 同じ (品・強化値) の個体のうち、いま見ている人の refs に無いものから順に割り当てて「ミオが そうび中」と出す。
 * 着ている人数がその品を持っている数より多い分は割り当てない (サーバーが通さない)。
 */
export function wornByOthers(pieces: readonly CraftedPiece[], mine: GearRefs, others: readonly GearWearer[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set(Object.values(mine).filter((v): v is string => !!v));
  for (const w of others) {
    for (const p of Object.values(w.gear)) {
      if (!p) continue;
      const k = typeof p === 'string' ? gearKey(p, undefined) : gearKey(p.id, p.level);
      const free = pieces.find((x) => gearKey(x.itemId, x.level) === k && !taken.has(x.rkey));
      if (!free) continue;
      taken.add(free.rkey);
      out.set(free.rkey, w.name);
    }
  }
  return out;
}

/** 仲間の装備 ({id, level}) を、その人に割り当てた個体の rkey 参照に (GearModal はそのまま使う)。 */
export function refsOfSelection(gear: GearSelection, pieces: readonly CraftedPiece[], avoid: ReadonlySet<string>): GearRefs {
  const refs: GearRefs = {};
  const used = new Set(avoid);
  for (const [slot, p] of Object.entries(gear) as Array<[keyof GearRefs, GearSelection[keyof GearSelection]]>) {
    if (!p) continue;
    const k = typeof p === 'string' ? gearKey(p, undefined) : gearKey(p.id, p.level);
    const hit = pieces.find((x) => gearKey(x.itemId, x.level) === k && !used.has(x.rkey));
    if (!hit) continue;
    used.add(hit.rkey);
    refs[slot] = hit.rkey;
  }
  return refs;
}

/** rkey 参照を、サーバーへ送る {id, level} に。 */
export function selectionOfRefs(refs: GearRefs, pieces: readonly CraftedPiece[]): GearSelection {
  const out: GearSelection = {};
  for (const [slot, rkey] of Object.entries(refs) as Array<[keyof GearRefs, string | undefined]>) {
    const p = rkey ? pieces.find((x) => x.rkey === rkey) : undefined;
    if (p) out[slot] = { id: p.itemId, level: p.level };
  }
  return out;
}
