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
