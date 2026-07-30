/**
 * 装備スロット拡張 (#609)。守るべき不変条件:
 * - 6 スロット (武器/盾/頭/胴/足/おまもり) 全部がボーナスに効く
 * - **両手の合計 ≤ 2**。両手武器 + 盾、両手盾 + 武器は盾側が落ちる (武器優先)
 * - 手数の検証は戦闘値の入口 (gearBonusFromGear) でも効く = レコード偽造でも超過は効かない
 */
import { describe, it, expect } from 'vitest';
import {
  EQUIPMENT,
  EQUIPMENT_BY_ID,
  GEAR_SLOTS,
  dropShieldIfHandsExceeded,
  equipHands,
  gearBonusFromGear,
  type GearSelection,
} from '../equipment.js';

const defOf = (v: unknown) => EQUIPMENT_BY_ID[typeof v === 'string' ? v : (v as { id: string }).id];

describe('ロスターの健全性', () => {
  it('盾・頭・足のスロットに品がある', () => {
    for (const slot of ['shield', 'head', 'feet'] as const) {
      expect(EQUIPMENT.some((e) => e.slot === slot), slot).toBe(true);
    }
  });

  it('hands は武器と盾にしか付いていない', () => {
    for (const e of EQUIPMENT) {
      if (e.hands !== undefined) expect(['weapon', 'shield']).toContain(e.slot);
    }
  });

  it('両手武器と両手盾が存在する (ルールが機能する前提)', () => {
    expect(EQUIPMENT.some((e) => e.slot === 'weapon' && e.hands === 2)).toBe(true);
    expect(EQUIPMENT.some((e) => e.slot === 'shield' && e.hands === 2)).toBe(true);
  });

  it('鉄の盾は盾スロットに移っている', () => {
    expect(EQUIPMENT_BY_ID['wp-iron-shield']!.slot).toBe('shield');
  });
});

describe('equipHands', () => {
  it('武器・盾は既定 1、両手品は 2、他スロットは 0', () => {
    expect(equipHands(EQUIPMENT_BY_ID['wp-knife']!)).toBe(1);
    expect(equipHands(EQUIPMENT_BY_ID['wp-great-sword']!)).toBe(2);
    expect(equipHands(EQUIPMENT_BY_ID['sh-tower']!)).toBe(2);
    expect(equipHands(EQUIPMENT_BY_ID['ar-cloth']!)).toBe(0);
    expect(equipHands(EQUIPMENT_BY_ID['ch-traveler']!)).toBe(0);
  });
});

describe('dropShieldIfHandsExceeded', () => {
  it('片手武器 + 盾は両立する', () => {
    const sel = { weapon: 'wp-knife', shield: 'sh-wood' };
    expect(dropShieldIfHandsExceeded(sel, defOf)).toEqual(sel);
  });

  it('両手武器 + 盾は盾が落ちる (武器優先)', () => {
    const out = dropShieldIfHandsExceeded({ weapon: 'wp-great-sword', shield: 'sh-wood' }, defOf);
    expect(out.weapon).toBe('wp-great-sword');
    expect(out.shield).toBeUndefined();
  });

  it('両手盾 + 武器も盾が落ちる (片手が空いていないと盾は持てない)', () => {
    const out = dropShieldIfHandsExceeded({ weapon: 'wp-knife', shield: 'sh-tower' }, defOf);
    expect(out.weapon).toBe('wp-knife');
    expect(out.shield).toBeUndefined();
  });

  it('両手盾だけなら持てる', () => {
    const sel = { shield: 'sh-tower' };
    expect(dropShieldIfHandsExceeded(sel, defOf)).toEqual(sel);
  });
});

describe('gearBonusFromGear (#609)', () => {
  it('6 スロット全部が合算される', () => {
    const gear: GearSelection = {
      weapon: 'wp-knife', // atk 2
      shield: 'sh-wood', // def 3
      head: 'hd-leather-hat', // def 2
      armor: 'ar-cloth', // def 5
      feet: 'ft-cloth-shoes', // def 1 agi 1
      charm: 'ch-traveler', // def 2
    };
    const b = gearBonusFromGear('warrior', gear);
    expect(b.atk).toBe(2);
    expect(b.def).toBe(3 + 2 + 5 + 1 + 2);
    expect(b.agi).toBe(1);
  });

  it('両手武器 + 盾は盾のぶんが 1 ポイントも効かない (レコード偽造対策)', () => {
    const withShield = gearBonusFromGear('warrior', { weapon: 'wp-great-sword', shield: 'wp-iron-shield' });
    const without = gearBonusFromGear('warrior', { weapon: 'wp-great-sword' });
    expect(withShield).toEqual(without);
  });

  it('スロット違いの品はどのスロットにも入らない (盾を武器枠に書けない)', () => {
    const b = gearBonusFromGear('warrior', { weapon: 'sh-wood' });
    expect(b.def).toBe(0);
  });

  it('GEAR_SLOTS は 6 スロット', () => {
    expect(GEAR_SLOTS).toEqual(['weapon', 'shield', 'head', 'armor', 'feet', 'charm']);
  });
});
