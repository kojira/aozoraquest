import type { ShopStock } from './equipment.js';
import type { ShopOverride } from './shop-data.js';

/** 明示的な導入設定。現在の品揃え・店主を保ち、全職で作れる一着を追加する。 */
export function starterTownShop(
  town: { x: number; y: number },
  stock: ShopStock,
  existing?: ShopOverride,
): ShopOverride {
  return {
    ...existing,
    x: town.x,
    y: town.y,
    equipment: [...new Set([...stock.equipment, 'ar-cloth'])],
    materialId: 'slime-drop',
  };
}
