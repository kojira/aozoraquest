/**
 * 装備の持ち主 (D-PARTY-004 §6)。主人公の gearSel と仲間の gear は {id, level} で持つので、
 * 「(品・強化値) ごとに 着ている人数 ≤ 持っている数」で 1 個は 1 人だけ を数える。数えるのはここ 1 か所。
 * 着る (主人公・仲間)・すてる・きたえる が使う。
 */
import { GEAR_SLOTS, type GearSelection } from './equipment.js';

/** (品・強化値) のキー。強化値の無い指定は 0。 */
export const gearKey = (id: string, level: number | undefined): string => `${id}+${level ?? 0}`;

/** 着ている人ごとの装備 (主人公は 'hero'、仲間は id)。 */
export type GearWearers = ReadonlyArray<{ who: string; gear: GearSelection | undefined }>;

/** (品・強化値) → 着ている人数。 */
export function equippedCounts(wearers: GearWearers): Map<string, number> {
  const out = new Map<string, number>();
  for (const { gear } of wearers) {
    for (const slot of GEAR_SLOTS) {
      const p = gear?.[slot];
      if (!p) continue;
      const k = typeof p === 'string' ? gearKey(p, undefined) : gearKey(p.id, p.level);
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}

/** (品・強化値) → 持っている数。 */
export function ownedCounts(pieces: ReadonlyArray<{ itemId: string; level: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pieces) out.set(gearKey(p.itemId, p.level), (out.get(gearKey(p.itemId, p.level)) ?? 0) + 1);
  return out;
}

/** 持っている数より多く着ている (品・強化値) のキー (無ければ空)。 */
export function overWorn(wearers: GearWearers, pieces: ReadonlyArray<{ itemId: string; level: number }>): string[] {
  const owned = ownedCounts(pieces);
  return [...equippedCounts(wearers)].filter(([k, n]) => n > (owned.get(k) ?? 0)).map(([k]) => k);
}

/** その (品・強化値) を、ほかの人 (who 以外) が着ているか。着ている人の一覧を返す (画面の「ミオが そうび中」)。 */
export function wornByOthers(wearers: GearWearers, who: string, id: string, level: number): string[] {
  const k = gearKey(id, level);
  return wearers.filter((w) => w.who !== who && GEAR_SLOTS.some((s) => { const p = w.gear?.[s]; return !!p && (typeof p === 'string' ? gearKey(p, undefined) : gearKey(p.id, p.level)) === k; })).map((w) => w.who);
}
