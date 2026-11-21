/**
 * そうびする前の「いまより いくつ上がる/下がる」(D-GEAR-DIFF-001)。
 * 戦闘と同じ入口 (gearBonusFromGear = 強化値・ジョブ制限・手数) と、防具の染まり (armorDye /
 * armorElementMultiplier) で、着る前と着た後を数えて引き算する。画面側で数値の式を持たない。
 */
import { ELEMENT_LABELS, type Element } from './elements.js';
import { BONUS_STAT_LABELS, EQUIPMENT_BY_ID, equipHands, gearBonusFromGear, signed, type BonusStat, type EquipSlot, type GearPiece, type GearSelection } from './equipment.js';
import { armorDye, armorElementMultiplier, weaponElement } from './gear-element.js';
import type { Archetype } from './types.js';

const ELEMENTS: readonly Element[] = ['earth', 'water', 'fire', 'wind', 'void'];

/** その品を slot に着けた後の装備。**新しく着ける品が勝つ**: 手数が 2 を超えたら、もう片方の手 (武器↔盾) を外す
 *  (そうび画面の equipWithHands と同じ規則 — 両手武器を持てば盾が、両手盾を持てば武器が外れる)。 */
export function gearAfterEquip(gear: GearSelection, slot: EquipSlot, piece: GearPiece): GearSelection {
  const next: GearSelection = { ...gear, [slot]: piece };
  if (slot !== 'weapon' && slot !== 'shield') return next;
  const other = slot === 'weapon' ? 'shield' : 'weapon';
  const held = next[other];
  const mine = EQUIPMENT_BY_ID[piece.id];
  const theirs = held ? EQUIPMENT_BY_ID[typeof held === 'string' ? held : held.id] : undefined;
  if (mine && theirs && equipHands(mine) + equipHands(theirs) > 2) delete next[other];
  return next;
}

export interface GearDelta {
  /** 変わるステータスだけ (0 は入れない)。並びは BONUS_STAT_LABELS の順。 */
  stats: Array<{ stat: BonusStat; delta: number }>;
  /** 防具の染まりで、その属性の攻撃から受けるダメージが減る属性 / 増える属性。 */
  stronger: Element[];
  weaker: Element[];
  /** 通常攻撃の属性が変わるなら変わった後 (null = 無属性)。変わらなければ undefined。 */
  weaponElement?: Element | null;
}

/**
 * wearer (archetype) が いまの装備 gear の slot に piece を着けたら、戦闘の値がどう変わるか。
 * gear は**参照している装備そのまま** (失効中の盾も含めてよい — 効くかどうかは gearBonusFromGear が決める)。
 * battleGear は戦闘で実際に着る形への変換 (仲間はからだが空なら PARTY_ARMOR を着る = partyMemberGear)。
 */
export function gearDeltaIfEquipped(
  archetype: Archetype,
  gear: GearSelection,
  slot: EquipSlot,
  piece: GearPiece,
  battleGear: (g: GearSelection) => GearSelection = (g) => g,
): GearDelta {
  const before = battleGear(gear);
  const after = battleGear(gearAfterEquip(gear, slot, piece));
  const b0 = gearBonusFromGear(archetype, before);
  const b1 = gearBonusFromGear(archetype, after);
  const stats = (Object.keys(BONUS_STAT_LABELS) as BonusStat[])
    .map((stat) => ({ stat, delta: b1[stat] - b0[stat] }))
    .filter((d) => d.delta !== 0);
  const d0 = armorDye(before);
  const d1 = armorDye(after);
  const stronger: Element[] = [];
  const weaker: Element[] = [];
  for (const e of ELEMENTS) {
    const m = armorElementMultiplier(d1, e) - armorElementMultiplier(d0, e);
    if (m < -1e-9) stronger.push(e);
    else if (m > 1e-9) weaker.push(e);
  }
  const w0 = weaponElement(before) ?? null;
  const w1 = weaponElement(after) ?? null;
  return { stats, stronger, weaker, ...(w0 !== w1 ? { weaponElement: w1 } : {}) };
}

/** 差の文: 「こうげき +6」「まもり -3」と、属性の一言 (「火に つよく」「水に よわく」「こうげきが 水に」)。 */
export function gearDeltaParts(d: GearDelta): { stats: Array<{ text: string; up: boolean }>; notes: string[] } {
  const names = (es: Element[]) => es.map((e) => ELEMENT_LABELS[e]).join('・');
  const notes: string[] = [];
  if (d.stronger.length) notes.push(`${names(d.stronger)}に つよく`);
  if (d.weaker.length) notes.push(`${names(d.weaker)}に よわく`);
  if (d.weaponElement !== undefined) notes.push(d.weaponElement ? `こうげきが ${ELEMENT_LABELS[d.weaponElement]}に` : 'こうげきが 無属性に');
  return { stats: d.stats.map((s) => ({ text: `${BONUS_STAT_LABELS[s.stat]} ${signed(s.delta)}`, up: s.delta > 0 })), notes };
}
