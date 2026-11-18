/** D-ENDGAME-001: 職ごとに「その grade で装備できる、いちばん守りの高い 1 式」を本物の品 (world.items) から選ぶ。
 *  sim (eg-ladder・sim-party-boss・eg-mask) が同じ選び方を使う。属性品・カジノ品・両手は選ばない (ELEM で属性の防具を選ぶ)。 */
import type { Archetype, GearSelection } from '../packages/core/src/index.js';
type Core = typeof import('../packages/core/src/index.js');
export function bestGearFor(core: Core, job: Archetype, grade: number, o: { dye?: string } = {}): GearSelection {
  if (grade <= 0) return { armor: { id: 'ar-cloth', level: 0 } };
  const ok = core.EQUIPMENT.filter((e) => e.grade === grade && !e.casinoOnly && (e.hands ?? 1) === 1 && core.canEquip(job, e));
  const score = (e: (typeof ok)[number]) => (e.bonus.def ?? 0) * 3 + (e.bonus.maxHp ?? 0) + (e.bonus.atk ?? 0) * 2 + (e.bonus.int ?? 0) * 2 + (e.bonus.agi ?? 0) * 0.5;
  const pick = (slot: string, el?: string) => ok.filter((e) => e.slot === slot && (el ? e.element === el : !e.element)).sort((a, b) => score(b) - score(a))[0];
  const out: GearSelection = {};
  for (const slot of ['weapon', 'shield', 'head', 'armor', 'feet', 'charm'] as const) {
    const e = (o.dye && slot !== 'weapon' && slot !== 'shield' ? pick(slot, o.dye) : undefined) ?? pick(slot);
    if (e) out[slot] = { id: e.id, level: 0 };
  }
  return out;
}
