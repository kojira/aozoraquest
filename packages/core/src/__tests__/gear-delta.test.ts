/**
 * そうびする前の差 (D-GEAR-DIFF-001)。守ること:
 * - 差は戦闘と同じ gearBonusFromGear で数える (強化値・ジョブ制限・手数)
 * - 両手武器を持つと盾が外れるので、盾のまもりが減るぶんも差に入る
 * - 変わらないステータスは出さない
 * - 防具の属性が変わると「火に つよく」「地に よわく」
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeEquipment, activeItems, bonusWithLevel, EQUIPMENT_BY_ID, gearAfterEquip, gearDeltaIfEquipped, gearDeltaParts, partyMemberGear, setItemOverrides,
  type EquipmentDef,
} from '../index.js';

afterEach(() => setItemOverrides(null));

const texts = (d: ReturnType<typeof gearDeltaIfEquipped>) => gearDeltaParts(d).stats.map((s) => s.text);

describe('gearDeltaIfEquipped', () => {
  it('たびのつるぎ (こうげき 7) → こんぼう (こうげき 4) は「こうげき -3」だけ', () => {
    const d = gearDeltaIfEquipped('warrior', { weapon: { id: 'wp-travel-sword', level: 0 } }, 'weapon', { id: 'wp-club', level: 0 });
    expect(texts(d)).toEqual(['こうげき -3']);
  });

  it('なにも持っていないときは、その品のボーナスがそのまま差になる (まもり +5)', () => {
    expect(texts(gearDeltaIfEquipped('warrior', {}, 'armor', { id: 'ar-cloth', level: 0 }))).toEqual(['まもり +5']);
  });

  it('両手武器を持つと盾が外れる: たびのつるぎ+鉄の盾 → グレートソード は「こうげき +6 まもり -4」', () => {
    const gear = { weapon: { id: 'wp-travel-sword', level: 0 }, shield: { id: 'wp-iron-shield', level: 0 } };
    const d = gearDeltaIfEquipped('warrior', gear, 'weapon', { id: 'wp-great-sword', level: 0 });
    expect(texts(d)).toEqual(['こうげき +6', 'まもり -4']);
    expect(gearAfterEquip(gear, 'weapon', { id: 'wp-great-sword', level: 0 }).shield).toBeUndefined();
  });

  it('両手盾を持つと武器が外れる (そうび画面の規則と同じ): たびのつるぎ → 騎士の大盾 は「こうげき -7 まもり +12」', () => {
    const d = gearDeltaIfEquipped('warrior', { weapon: { id: 'wp-travel-sword', level: 0 } }, 'shield', { id: 'sh-tower', level: 0 });
    expect(texts(d)).toEqual(['こうげき -7', 'まもり +12']);
  });

  it('強化した品は強化値ぶん: たびのマント+5 は bonusWithLevel と同じ まもり (ぬののふく から)', () => {
    const forged = bonusWithLevel(EQUIPMENT_BY_ID['ar-travel-cloak']!, 5).def!;
    expect(forged).toBe(23);
    const d = gearDeltaIfEquipped('warrior', { armor: { id: 'ar-cloth', level: 0 } }, 'armor', { id: 'ar-travel-cloak', level: 5 });
    expect(texts(d)).toEqual([`まもり +${forged - 5}`]);
  });

  it('同じ強さなら差は空 (かわのよろい ⇄ ぬののふく)', () => {
    expect(gearDeltaIfEquipped('warrior', { armor: 'ar-leather' }, 'armor', { id: 'ar-cloth', level: 0 }).stats).toEqual([]);
  });

  it('ジョブで効いていない品を着がえると、効いていない分は差に入らない (魔法使いの鉄のよろい → ぬののふく は まもり +5)', () => {
    expect(texts(gearDeltaIfEquipped('mage', { armor: 'ar-iron' }, 'armor', { id: 'ar-cloth', level: 0 }))).toEqual(['まもり +5']);
  });

  it('仲間は からだが空なら ぬののふく を着て戦う (partyMemberGear)。その分を引いた差になる', () => {
    const d = gearDeltaIfEquipped('warrior', {}, 'armor', { id: 'ar-travel-cloak', level: 0 }, (g) => partyMemberGear(g, 5));
    expect(texts(d)).toEqual(['まもり +10']);
  });

  it('防具の属性: 水のころもを着ると 火に つよく・地に よわく', () => {
    const water: EquipmentDef = { id: 'ar-mizu', name: 'みずの ころも', slot: 'armor', kind: 'cloth', grade: 1, price: { power: 1, materials: 0 }, bonus: { def: 5 }, element: 'water' };
    setItemOverrides({ items: activeItems(), equipment: [...activeEquipment(), water] });
    const d = gearDeltaIfEquipped('warrior', { armor: 'ar-cloth' }, 'armor', { id: 'ar-mizu', level: 0 });
    expect(d.stats).toEqual([]);
    expect(gearDeltaParts(d).notes).toEqual(['火に つよく', '地に よわく']);
  });

  it('武器の属性が変わると「こうげきが 空に」', () => {
    const d = gearDeltaIfEquipped('warrior', { weapon: 'wp-club' }, 'weapon', { id: 'wp-star-sword', level: 0 });
    expect(texts(d)).toEqual(['こうげき +14', 'うん +4']);
    expect(gearDeltaParts(d).notes).toEqual(['こうげきが 空に']);
  });
});
