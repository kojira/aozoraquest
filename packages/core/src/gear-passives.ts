/**
 * **装備から付く効果** (D-RARE-GEAR-001)。貴重な装備だけが持つ、今ある戦闘の仕組みを使った効果。
 *
 * - `passive`: 下の GEAR_PASSIVES の id。PASSIVES に足すので、戦闘のフック (incomingCalc) と
 *   メタデータ (mpCostFactor) は ジョブのパッシブ と同じ道を通る。同じパッシブは重ねない。
 * - `statusResist`: 着ている間 効かない状態異常。applyStatus が今のまま Combatant.statusResist を見る。
 * playerCombatant (battle-combatant.ts) が gearEffects を 1 回呼んで Combatant に入れる。
 */
import { EQUIPMENT_BY_ID, GEAR_SLOTS, canEquip, dropShieldIfHandsExceeded, type GearPiece, type GearSelection } from './equipment.js';
import { PASSIVES, type PassiveDef, type StatusId } from './statuses.js';
import type { Archetype } from './types.js';

/** 装備のパッシブ。 */
export const GEAR_PASSIVES: Readonly<Record<string, PassiveDef>> = {
  // あおぞらの加護: 受けるダメージ ×0.9。ボスの全体攻撃 (smash) も applyIncomingCalc を通るので効く。
  'gear-sky-guard': { id: 'gear-sky-guard', name: 'あおぞらの加護', incomingCalc: (p) => p * 0.9 },
  // こころのゆとり: とくぎの MP ×0.85 (発明家・巫女の直感と同じメタデータ。掛け合わせ)。
  'gear-mp-thrift': { id: 'gear-mp-thrift', name: 'こころのゆとり', mpCostFactor: 0.85 },
};
Object.assign(PASSIVES, GEAR_PASSIVES);

const idOf = (v: GearPiece | string) => (typeof v === 'string' ? v : v.id);

/** 着ている装備のパッシブと、効かない状態異常 (重ねない)。装備できない品・部位の違う品は数えない (gearBonusFromGear と同じ)。 */
export function gearEffects(archetype: Archetype, gear: GearSelection | undefined): { passives: string[]; statusResist: StatusId[] } {
  const passives = new Set<string>();
  const resist = new Set<StatusId>();
  const sel = gear ? dropShieldIfHandsExceeded(gear, (v) => EQUIPMENT_BY_ID[idOf(v as GearPiece | string)]) : {};
  for (const slot of GEAR_SLOTS) {
    const piece = sel[slot];
    const def = piece ? EQUIPMENT_BY_ID[idOf(piece)] : undefined;
    if (!def || def.slot !== slot || !canEquip(archetype, def)) continue;
    if (def.passive && GEAR_PASSIVES[def.passive]) passives.add(def.passive);
    for (const s of def.statusResist ?? []) resist.add(s);
  }
  return { passives: [...passives], statusResist: [...resist] };
}
