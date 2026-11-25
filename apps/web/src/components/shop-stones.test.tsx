// @vitest-environment jsdom
/**
 * 店の画面の魔石 (D-MATERIAL-001)。プレイヤーに見える振る舞い:
 * - 属性つきの装備の値札は「パワー + その属性の魔石 + 町の魔石」と分けて出る。足りないと押せない。
 * - 町の「魔石の交換」の段に、品と町の魔石の数が出て、「こうかん」で onExchange。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EQUIPMENT, ITEMS, setItemOverrides, setShopOverrides, worldOverlay, type EquipmentDef } from '@aozoraquest/core';
import { ShopModal } from './shop-modal';

const town = worldOverlay().towns[0]!;
const FIRE: EquipmentDef = { id: 'wp-fire-ui', name: 'ほのおの けん', slot: 'weapon', kind: 'common', bonus: { atk: 5 }, grade: 1, price: { power: 8, materials: 9 }, element: 'fire' };
const setup = () => {
  setItemOverrides({ items: Object.entries(ITEMS).map(([id, v]) => ({ id, ...v })), equipment: [...EQUIPMENT, FIRE] });
  setShopOverrides([{ x: town.x, y: town.y, theme: 'water', equipment: [FIRE.id], exchange: [{ itemId: 'herb', stones: 4 }] }]);
};
const view = (materials: Record<string, number>, onExchange = vi.fn()) => {
  render(
    <ShopModal town={town} townIndex={0} archetype={null} balance={99} materials={materials} pieces={[]} equippedRkeys={[]}
      busy={false} lastAction={null} errorText={null} onCraft={vi.fn()} onForge={vi.fn()} onSell={vi.fn()} onBuy={vi.fn()} onExchange={onExchange} onClose={vi.fn()} />,
  );
  return onExchange;
};

describe('店の画面の魔石 (D-MATERIAL-001)', () => {
  afterEach(() => { cleanup(); setShopOverrides(null); setItemOverrides(null); });

  it('水の町の火の装備: 「パワー8 + 火の魔石 ×3 + 水の魔石 ×6」。火が足りないと押せない', () => {
    setup();
    view({ 'stone-fire': 2, 'stone-water': 20 });
    expect(screen.getByText('パワー8 + 火の魔石 ×3 + 水の魔石 ×6')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'つくってもらう' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    view({ 'stone-fire': 3, 'stone-water': 6 });
    expect((screen.getByRole('button', { name: 'つくってもらう' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('魔石の交換: 品と町の魔石の数が出て、「こうかん」で onExchange。足りないと押せない', () => {
    setup();
    const onExchange = view({ 'stone-water': 4 });
    expect(screen.getByText('魔石の交換')).toBeTruthy();
    expect(screen.getByText('水の魔石 ×4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'こうかん' }));
    expect(onExchange).toHaveBeenCalledWith('herb');
    cleanup();
    view({ 'stone-water': 3, 'stone-fire': 50 });
    expect((screen.getByRole('button', { name: 'こうかん' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
