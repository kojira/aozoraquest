import { EQUIPMENT_BY_ID, ITEMS, SEARCH_TUNING, WORLD_MAP_ID, placedItemAt, placedSearchOutcome, withCharacterNames, type PlacedKind, type PlacedReward } from '@aozoraquest/core';

/**
 * しらべた結果の文言とメニューのラベル (D-CHEST-001 §5・§6)。付与と判定は edge が正。
 */
const itemName = (id: string) => withCharacterNames(ITEMS[id]?.name ?? id);

function rewardText(r: PlacedReward, alone: boolean): string {
  if ('item' in r) return `${itemName(r.item)}${r.count > 1 ? `×${r.count}` : ''}`;
  if ('equipment' in r) return withCharacterNames(EQUIPMENT_BY_ID[r.equipment]?.name ?? r.equipment);
  return alone ? `あおぞらパワーを ${r.power} ` : `あおぞらパワー${r.power}`;
}

/** 取った結果の 1 行。 */
export function placedTakenText(placed: { kind: PlacedKind; rewards: PlacedReward[]; itemId?: string; count?: number }): string {
  if (placed.kind === 'spot' && placed.itemId !== undefined && placed.rewards.length === 1) {
    const count = placed.count ?? 1;
    return `${itemName(placed.itemId)}${count > 1 ? `を${count}こ` : 'を'}手に入れた!`;
  }
  const alone = placed.rewards.length === 1;
  const names = placed.rewards.map((r) => rewardText(r, alone)).join('と ');
  const got = alone && 'power' in placed.rewards[0]! ? `${names}手に入れた！` : `${names}を手に入れた！`;
  const gear = placed.rewards.some((r) => 'equipment' in r) ? '（そうびで確認）' : '';
  const prefix = placed.kind === 'chest' ? '宝箱を開けた！ ' : placed.kind === 'sparkle' ? 'キラキラ光る場所を調べた！ ' : '';
  return `${prefix}${got}${gear}`;
}

/** 空の宝箱・鍵のマスの 1 行。 */
export function placedStateText(state: 'empty' | 'locked', hint: string | undefined): string {
  if (state === 'empty') return 'からっぽだ。';
  return hint ?? 'かたく閉じている。';
}

/** いま立っているマスが無料のしらべるか (取れる・空の宝箱・鍵)。パワー不足で止めない判定にも使う。 */
export function placedSearchFreeAt(at: { mapId?: string; x: number; y: number }, flags: readonly string[], opened: readonly string[]): boolean {
  const p = placedItemAt(at.mapId ?? WORLD_MAP_ID, at.x, at.y);
  return !!p && placedSearchOutcome(p, flags, opened) !== 'paid';
}

/** メニューのラベル。無料のマスではパワーの表記を出さない。 */
export function searchMenuLabel(at: { mapId?: string; x: number; y: number }, flags: readonly string[], opened: readonly string[]): string {
  return placedSearchFreeAt(at, flags, opened) ? 'しらべる' : `しらべる (パワー${SEARCH_TUNING.powerCost})`;
}
