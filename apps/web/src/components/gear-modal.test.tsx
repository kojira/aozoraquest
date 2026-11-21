// @vitest-environment jsdom
/**
 * そうび画面の属性 (D-ELEM-001)。
 * - 装備名の横に属性 (「みずの ころも（水）」)
 * - 「守りの属性: 水 75%・空 25%」の要約 (防具の染まり)
 * - いまの装備と隣り合う属性の防具は「そうびする」を押せない
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { activeEquipment, activeItems, setItemOverrides, type EquipmentDef } from '@aozoraquest/core';
import { GearModal } from './gear-modal';

const g = (id: string, name: string, slot: EquipmentDef['slot'], element?: EquipmentDef['element']): EquipmentDef =>
  ({ id, name, slot, kind: 'cloth', grade: 1, price: { power: 1, materials: 0 }, bonus: { def: 1 }, ...(element ? { element } : {}) });
const GEAR = [g('ar-mizu', 'みずの ころも', 'armor', 'water'), g('hd-mizu', 'みずの ずきん', 'head', 'water'), g('ft-sora', 'そらの くつ', 'feet', 'void'), g('ch-hi', 'ひの おまもり', 'charm', 'fire')];
const pieces = [
  { rkey: 'a', itemId: 'ar-mizu', level: 0, at: '' }, { rkey: 'h', itemId: 'hd-mizu', level: 0, at: '' },
  { rkey: 'f', itemId: 'ft-sora', level: 0, at: '' }, { rkey: 'c', itemId: 'ch-hi', level: 0, at: '' },
];
afterEach(() => { cleanup(); setItemOverrides(null); });

function open() {
  setItemOverrides({ items: activeItems(), equipment: [...activeEquipment(), ...GEAR] });
  return render(<GearModal archetype="warrior" pieces={pieces} refs={{ armor: 'a', head: 'h', feet: 'f' }} onEquip={vi.fn()} onUnequip={vi.fn()} onDiscard={vi.fn()} onClose={vi.fn()} />);
}

describe('GearModal の属性', () => {
  it('装備名の横に属性、上に「守りの属性: 水 75%・空 25%」の要約', () => {
    open();
    expect(screen.getAllByText('みずの ころも（水）').length).toBeGreaterThan(0);
    // 胴 0.5 + 頭 0.25 = 水 75%、足の空 0.25 → 合計 1.0 なので正規化なし
    expect(screen.getByTestId('gear-dye').textContent).toBe('守りの属性: 水 75%・空 25%');
  });

  it('水を着ているとき、火のおまもりは「そうびする」を押せず、理由が出る', () => {
    open();
    const row = screen.getByText('ひの おまもり（火）').closest('div')!;
    expect((within(row).getByRole('button', { name: 'そうびする' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(row).getByText('(となりの属性とは いっしょに着られない)')).toBeTruthy();
  });
});

describe('GearModal の そうびする前の差 (D-GEAR-DIFF-001)', () => {
  const p = (rkey: string, itemId: string, level = 0) => ({ rkey, itemId, level, at: '' });
  const deltaOf = (name: string) => within(screen.getByText(name).closest('div')!).queryByTestId('gear-delta')?.textContent ?? null;

  it('たびのつるぎを持っていると、こんぼうは「こうげき -3」、グレートソードは盾が外れて「こうげき +6まもり -4」', () => {
    render(<GearModal archetype="warrior" pieces={[p('s', 'wp-travel-sword'), p('c', 'wp-club'), p('g', 'wp-great-sword'), p('i', 'wp-iron-shield')]}
      refs={{ weapon: 's', shield: 'i' }} onEquip={vi.fn()} onUnequip={vi.fn()} onDiscard={vi.fn()} onClose={vi.fn()} />);
    expect(deltaOf('こんぼう')).toBe('こうげき -3');
    expect(deltaOf('グレートソード')).toBe('こうげき +6まもり -4');
  });

  it('強化した品は強化値ぶん (ぬののふく → たびのマント+5 は まもり +18)。そうび中の品には出さない', () => {
    render(<GearModal archetype="warrior" pieces={[p('m', 'ar-travel-cloak', 5), p('k', 'ar-cloth')]}
      refs={{ armor: 'k' }} onEquip={vi.fn()} onUnequip={vi.fn()} onDiscard={vi.fn()} onClose={vi.fn()} />);
    expect(deltaOf('たびのマント+5')).toBe('まもり +18');
    expect(screen.getAllByTestId('gear-delta')).toHaveLength(1);
  });

  it('装備できない品は差ではなく理由だけ (魔法使いに戦斧)', () => {
    render(<GearModal archetype="mage" pieces={[p('a', 'wp-axe')]} refs={{}} onEquip={vi.fn()} onUnequip={vi.fn()} onDiscard={vi.fn()} onClose={vi.fn()} />);
    expect(deltaOf('戦斧')).toBeNull();
    expect(screen.getByText('(装備できない)')).toBeTruthy();
  });

  it('同じ強さなら「かわらない」', () => {
    render(<GearModal archetype="warrior" pieces={[p('l', 'ar-leather'), p('k', 'ar-cloth')]} refs={{ armor: 'k' }} onEquip={vi.fn()} onUnequip={vi.fn()} onDiscard={vi.fn()} onClose={vi.fn()} />);
    expect(deltaOf('かわのよろい')).toBe('かわらない');
  });
});
