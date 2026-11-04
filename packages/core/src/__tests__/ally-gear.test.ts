/**
 * 仲間の装備 (D-PARTY-004 B1)。
 * - 仲間の装備は戦闘の atk/def に乗る (職の合わない品は数えない)。からだが空なら Lv1 から ぬののふく
 * - 武器の属性は仲間の通常攻撃にも、防具の染まりも仲間に (D-ELEM-001 の関数のまま)
 * - equippedCounts: (品・強化値) ごとに 主人公＋仲間 の着ている人数。overWorn は持っている数を超えたもの
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeEquipment, activeItems, equippedCounts, overWorn, partyCombatants, playerCombatant, setItemOverrides, wornByOthers,
  type EquipmentDef,
} from '../index.js';

const ally = (gear?: Parameters<typeof partyCombatants>[0][number]['gear'], level = 5) => partyCombatants([{ id: 'g:m', name: 'ミオ', archetype: 'warrior', level, ...(gear ? { gear } : {}) }], level)[0]!;
afterEach(() => setItemOverrides(null));

describe('仲間の装備が戦闘に乗る', () => {
  it('たびのつるぎ (atk 7) とかわのよろい (def 5) が乗る。からだがあれば ぬののふく は足さない', () => {
    const base = playerCombatant('warrior', 5, 1, 'ミオ');
    const c = ally({ weapon: { id: 'wp-travel-sword', level: 0 }, armor: { id: 'ar-leather', level: 0 } });
    expect(c.atk).toBe(base.atk + 7);
    expect(c.def).toBe(base.def + 5);
  });

  it('からだが空の Lv1 の仲間は ぬののふく (def 5)', () => {
    expect(ally(undefined, 1).def).toBe(playerCombatant('warrior', 1, 1, 'ミオ').def + 5);
    expect(ally({ weapon: { id: 'wp-travel-sword', level: 0 } }, 1).def).toBe(playerCombatant('warrior', 1, 1, 'ミオ').def + 5);
  });

  it('職の合わない jobOnly の品は数えない', () => {
    const only = activeEquipment().find((e) => e.jobOnly && e.jobOnly !== 'warrior' && e.slot === 'weapon')!;
    const c = ally({ weapon: { id: only.id, level: 0 } });
    expect(c.atk).toBe(playerCombatant('warrior', 5, 1, 'ミオ').atk);
  });

  it('武器の属性・防具の染まりも仲間に', () => {
    const el: EquipmentDef[] = [
      { id: 'wp-water', name: 'みず', slot: 'weapon', kind: 'common', grade: 1, price: { power: 1, materials: 0 }, bonus: {}, element: 'water' },
      { id: 'ar-fire', name: 'ひ', slot: 'armor', kind: 'cloth', grade: 1, price: { power: 1, materials: 0 }, bonus: {}, element: 'fire' },
    ];
    setItemOverrides({ items: activeItems(), equipment: [...activeEquipment(), ...el] });
    const c = ally({ weapon: { id: 'wp-water', level: 0 }, armor: { id: 'ar-fire', level: 0 } });
    expect(c.weaponElement).toBe('water');
    expect(c.armorDye?.fire).toBeCloseTo(0.5);
  });
});

describe('equippedCounts (1 個は 1 人だけ)', () => {
  const sword = { weapon: { id: 'wp-travel-sword', level: 0 } };
  it('主人公と仲間の 2 人が同じ (品・強化値) を着ていれば 2', () => {
    expect(equippedCounts([{ who: 'hero', gear: sword }, { who: 'g:m', gear: sword }]).get('wp-travel-sword+0')).toBe(2);
  });
  it('1 本しか持っていなければ overWorn、2 本なら空。強化値が違えば別の品', () => {
    const one = [{ itemId: 'wp-travel-sword', level: 0 }];
    const w = [{ who: 'hero', gear: sword }, { who: 'g:m', gear: sword }];
    expect(overWorn(w, one)).toEqual(['wp-travel-sword+0']);
    expect(overWorn(w, [...one, ...one])).toEqual([]);
    expect(overWorn([{ who: 'hero', gear: sword }, { who: 'g:m', gear: { weapon: { id: 'wp-travel-sword', level: 1 } } }], [...one, { itemId: 'wp-travel-sword', level: 1 }])).toEqual([]);
  });
  it('wornByOthers はほかの人の名前 (id)', () => {
    expect(wornByOthers([{ who: 'hero', gear: sword }, { who: 'g:m', gear: {} }], 'g:m', 'wp-travel-sword', 0)).toEqual(['hero']);
    expect(wornByOthers([{ who: 'hero', gear: sword }], 'hero', 'wp-travel-sword', 0)).toEqual([]);
  });
});
