// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EQUIPMENT, EQUIPMENT_BY_ID, ITEMS, setItemOverrides, townShopStock, worldOverlay } from '@aozoraquest/core';
import { ShopModal } from './shop-modal';

describe('ShopModal の値段表示', () => {
  afterEach(() => { cleanup(); setItemOverrides(null); });

  it('素材 0 の品は「パワーN」だけを出し、「×0」を出さない (#795)', () => {
    const town = worldOverlay().towns[0]!;
    const stock = townShopStock(town, 0);
    const [freeId, paidId] = stock.equipment;
    const items = Object.entries(ITEMS).map(([id, v]) => ({ id, name: v.name, ...(v.key ? { key: true } : {}) }));
    setItemOverrides({ items, equipment: EQUIPMENT.map((e) => (e.id === freeId ? { ...e, price: { ...e.price, materials: 0 } } : e)) });
    const free = EQUIPMENT_BY_ID[freeId!]!;
    const paid = EQUIPMENT_BY_ID[paidId!]!;
    expect(paid.price.materials).toBeGreaterThan(0);
    const materialName = ITEMS[stock.materialId]?.name ?? stock.materialId;
    render(
      <ShopModal town={town} townIndex={0} archetype={null} balance={99} materials={{}} pieces={[]} equippedRkeys={[]}
        busy={false} lastAction={null} errorText={null} onCraft={vi.fn()} onForge={vi.fn()} onSell={vi.fn()} onBuy={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getAllByText(`パワー${free.price.power}`).length).toBeGreaterThan(0);
    expect(screen.queryByText(`パワー${free.price.power} + ${materialName} ×0`)).toBeNull();
    expect(screen.getByText(`パワー${paid.price.power} + ${materialName} ×${paid.price.materials}`)).toBeTruthy();
  });
});

describe('ShopModal の「どうぐ」(D-ITEM-001)', () => {
  afterEach(() => { cleanup(); setItemOverrides(null); });
  const town = worldOverlay().towns[0]!;
  const withSale = () => setItemOverrides({
    items: [...Object.entries(ITEMS).map(([id, v]) => ({ id, ...v })),
      { id: 'nemuri-kona', name: 'ねむりごな', desc: '敵 1 体を眠らせる', price: { power: 3, materials: 1 }, shopTier: 1,
        battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', chance: 0.7, turns: 3 }] } }],
    equipment: [...EQUIPMENT],
  });
  const view = (balance: number, materials: Record<string, number>, onBuy = vi.fn()) => {
    render(
      <ShopModal town={town} townIndex={0} archetype={null} balance={balance} materials={materials} pieces={[]} equippedRkeys={[]}
        busy={false} lastAction={null} errorText={null} onCraft={vi.fn()} onForge={vi.fn()} onSell={vi.fn()} onBuy={onBuy} onClose={vi.fn()} />,
    );
    return onBuy;
  };

  it('値段・desc・持っている数を出し、「かう」で onBuy', () => {
    withSale();
    const stock = townShopStock(town, 0);
    const materialName = ITEMS[stock.materialId]?.name ?? stock.materialId;
    const onBuy = view(10, { [stock.materialId]: 1, 'nemuri-kona': 2 });
    expect(screen.getByText('ねむりごな')).toBeTruthy();
    expect(screen.getByText('敵 1 体を眠らせる')).toBeTruthy();
    expect(screen.getByText('所持2')).toBeTruthy();
    expect(screen.getByText(`パワー3 + ${materialName} ×1`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'かう' }));
    expect(onBuy).toHaveBeenCalledWith('nemuri-kona');
  });

  it('パワーか素材が足りなければ「かう」は押せない', () => {
    withSale();
    const stock = townShopStock(town, 0);
    view(2, { [stock.materialId]: 1 });
    expect((screen.getByRole('button', { name: 'かう' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    view(10, {});
    expect((screen.getByRole('button', { name: 'かう' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('値段の無い品しかなければ「どうぐ」の段は出ない', () => {
    view(10, {});
    expect(screen.queryByRole('button', { name: 'かう' })).toBeNull();
  });
});
