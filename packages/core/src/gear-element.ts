/**
 * 装備の属性 (D-ELEM-001。docs/25 §1 の「通常攻撃は無属性」を変更。D-PARTY-002 §13・§13a・§13b)。
 * - 武器の属性: 通常攻撃 (attack コマンド) だけがその属性で殴る。とくぎは自分の属性 (無ければ無属性)
 * - 防具の染まり: 部位の基本値 + 0.05 × 強化値 (1 部位 0〜1)。属性ごとに合算し、合計が 1 を超えたら比率を保って 1 に
 * - 被ダメ倍率: 4 元素は 1 + Σ 染まり_e × (elementMultiplier(攻撃, e) − 1)。空は 1 + s_void × (voidArmorGuard − 1)
 *   を 4 元素の攻撃に、1 + s_void × (1.2 − 1) を空の攻撃に掛ける。無属性 (物理) は等倍
 * - 隣り合う属性 (地-水・水-火・火-風・風-地) は同時に着られない (空は輪の外で、どれとも着られる)
 */
import { ELEMENT_MULT, elementMultiplier, type Element } from './elements.js';
import { EQUIPMENT_BY_ID, GEAR_SLOTS, type EquipSlot, type GearPiece, type GearSelection } from './equipment.js';

/** 部位ごとの染まりの基本値 (§13a)。武器・盾は守りの染まりに入れない。 */
export const ARMOR_DYE_BASE: Partial<Record<EquipSlot, number>> = { head: 0.25, armor: 0.5, feet: 0.25, charm: 0.25 };
/** 強化値 1 あたりの染まり (§13b)。 */
export const ARMOR_DYE_PER_LEVEL = 0.05;
/** 空の防具 100% で、4 元素の攻撃に掛かる倍率 (§13a。BATTLE_TUNING と同じく 1 か所の定数)。 */
export const VOID_ARMOR_GUARD = 0.8;

export const ELEMENT_LABELS: Record<Element, string> = { earth: '地', water: '水', fire: '火', wind: '風', void: '空' };
/** 4 元素 (輪の上)。表示と計算の並び。 */
const RING: readonly Element[] = ['earth', 'water', 'fire', 'wind'];
const ALL: readonly Element[] = [...RING, 'void'];

/** 輪で隣り合うか (同時に着られない組)。空はどれとも隣ではない。 */
export function adjacentElements(a: Element, b: Element): boolean {
  if (a === 'void' || b === 'void' || a === b) return false;
  const d = Math.abs(RING.indexOf(a) - RING.indexOf(b));
  return d === 1 || d === 3;
}

/** 防具の部位 (染まりに入る枠) か。 */
const isArmorSlot = (slot: EquipSlot) => ARMOR_DYE_BASE[slot] !== undefined;

const pieceOf = (v: GearPiece | string | undefined): { id: string; level: number } | undefined => {
  if (!v) return undefined;
  if (typeof v === 'string') return { id: v, level: 0 };
  return { id: v.id, level: typeof v.level === 'number' && Number.isFinite(v.level) ? v.level : 0 };
};

/** 1 部位の染まり (0〜1)。属性の無い品・枠と slot が違う品は 0。 */
export function pieceDye(slot: EquipSlot, piece: GearPiece | string | undefined): { element: Element; dye: number } | undefined {
  const p = pieceOf(piece);
  const def = p && EQUIPMENT_BY_ID[p.id];
  const base = ARMOR_DYE_BASE[slot];
  if (!def || !def.element || def.slot !== slot || base === undefined) return undefined;
  return { element: def.element, dye: Math.min(1, Math.max(0, base + ARMOR_DYE_PER_LEVEL * p!.level)) };
}

/** 防具の染まり (属性 → 0〜1。合計は 1 まで)。 */
export function armorDye(gear: GearSelection | undefined): Partial<Record<Element, number>> {
  const sum: Partial<Record<Element, number>> = {};
  for (const slot of GEAR_SLOTS) {
    if (!isArmorSlot(slot)) continue;
    const d = pieceDye(slot, gear?.[slot]);
    if (d && d.dye > 0) sum[d.element] = (sum[d.element] ?? 0) + d.dye;
  }
  const total = Object.values(sum).reduce((a, b) => a + (b ?? 0), 0);
  if (total > 1) for (const e of Object.keys(sum) as Element[]) sum[e] = sum[e]! / total;
  return sum;
}

/** 防具の染まりで決まる被ダメ倍率 (攻撃の属性ごと)。無属性の攻撃は常に 1。 */
export function armorElementMultiplier(dye: Partial<Record<Element, number>>, attack: Element | null | undefined): number {
  if (!attack) return 1;
  const sVoid = dye.void ?? 0;
  if (attack === 'void') return 1 + sVoid * (ELEMENT_MULT.voidMult - 1);
  let m = 1;
  for (const e of RING) m += (dye[e] ?? 0) * (elementMultiplier(attack, e) - 1);
  return m * (1 + sVoid * (VOID_ARMOR_GUARD - 1));
}

/** 武器の攻撃属性 (通常攻撃だけに使う)。 */
export function weaponElement(gear: GearSelection | undefined): Element | undefined {
  const p = pieceOf(gear?.weapon);
  const def = p && EQUIPMENT_BY_ID[p.id];
  return def && def.slot === 'weapon' ? def.element : undefined;
}

/** 隣り合う属性の防具が一緒に入っていたら、その 2 部位 (先に入っている部位, 後の部位) を返す。無ければ undefined。 */
export function adjacentArmorConflict(gear: GearSelection | undefined): [EquipSlot, EquipSlot] | undefined {
  const seen: Array<[EquipSlot, Element]> = [];
  for (const slot of GEAR_SLOTS) {
    if (!isArmorSlot(slot)) continue;
    const d = pieceDye(slot, gear?.[slot]);
    if (!d) continue;
    const hit = seen.find(([, e]) => adjacentElements(e, d.element));
    if (hit) return [hit[0], slot];
    seen.push([slot, d.element]);
  }
  return undefined;
}

/** その品をいまの装備に足すと、隣り合う属性になるか (画面で選べなくする)。 */
export function wouldConflict(gear: GearSelection | undefined, slot: EquipSlot, itemId: string): boolean {
  const def = EQUIPMENT_BY_ID[itemId];
  if (!def?.element || !isArmorSlot(slot)) return false;
  return GEAR_SLOTS.some((s) => s !== slot && isArmorSlot(s) && (() => { const d = pieceDye(s, gear?.[s]); return !!d && adjacentElements(d.element, def.element!); })());
}

/** 「火 75%・空 25%」。染まりが無ければ空文字。 */
export function armorDyeSummary(gear: GearSelection | undefined): string {
  const dye = armorDye(gear);
  return ALL.filter((e) => (dye[e] ?? 0) > 0).map((e) => `${ELEMENT_LABELS[e]} ${Math.round(dye[e]! * 100)}%`).join('・');
}

/** 装備名の横の属性マーク (「みずの つるぎ（水）」)。属性が無ければ名前のまま。 */
export function withElementMark(name: string, element: Element | undefined): string {
  return element ? `${name}（${ELEMENT_LABELS[element]}）` : name;
}
