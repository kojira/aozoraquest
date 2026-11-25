import { ITEMS, canPayStones, shopPriceStones, withCharacterNames, type Element, type ShopStock } from '@aozoraquest/core';

/**
 * 店の値札の表示 (D-MATERIAL-001)。払う魔石はサーバーと同じ core の `shopPriceStones` で出す。
 * 例: 「パワー8 + 火の魔石 ×1 + 水の魔石 ×2」。魔石のいらない品は「パワー8」。
 */
export function stonePriceText(stock: Pick<ShopStock, 'theme'>, price: { power: number; materials: number }, element?: Element): string {
  const stones = Object.entries(shopPriceStones(stock, price, element));
  return [`パワー${price.power}`, ...stones.map(([id, n]) => `${withCharacterNames(ITEMS[id]?.name ?? id)} ×${n}`)].join(' + ');
}

/** 手持ちで買えるか (押せるかの目安。判定の正はサーバー)。 */
export function canAffordStonePrice(
  stock: Pick<ShopStock, 'theme'>,
  price: { power: number; materials: number },
  balance: number,
  materials: Readonly<Record<string, number>>,
  element?: Element,
): boolean {
  return balance >= price.power && canPayStones(materials, shopPriceStones(stock, price, element));
}
