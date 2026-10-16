// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
        busy={false} lastAction={null} errorText={null} onCraft={vi.fn()} onForge={vi.fn()} onSell={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getAllByText(`パワー${free.price.power}`).length).toBeGreaterThan(0);
    expect(screen.queryByText(`パワー${free.price.power} + ${materialName} ×0`)).toBeNull();
    expect(screen.getByText(`パワー${paid.price.power} + ${materialName} ×${paid.price.materials}`)).toBeTruthy();
  });
});
