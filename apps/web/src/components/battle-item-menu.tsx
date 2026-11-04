import { ITEMS, withCharacterNames, type BattleState } from '@aozoraquest/core';

/**
 * 戦闘の「どうぐ」に並べる戦闘用のどうぐ (D-ITEM-001)。数は封印した state.battleItems。
 * 0 個の品は出さない。ねらう相手の選択 (D-PARTY B3) が入るまでは、敵が何体でも 1 体目に使う。
 */
export function battleItemEntries(state: BattleState): Array<{ id: string; name: string; count: number }> {
  return Object.entries(state.battleItems ?? {})
    .filter(([id, n]) => n > 0 && ITEMS[id]?.battle)
    .map(([id, n]) => ({ id, name: withCharacterNames(ITEMS[id]!.name), count: n }));
}

/** 「どうぐ」の行が押せるか (やくそう・しずく・戦闘用のどうぐのどれかが 1 個以上)。 */
export function hasAnyBattleItem(state: BattleState): boolean {
  return state.herbs > 0 || state.tonics > 0 || battleItemEntries(state).length > 0;
}

export function BattleItemRows({ state, busy, onUse, Row }: {
  state: BattleState;
  busy: boolean;
  onUse: (itemId: string) => void;
  Row: (p: { label: string; onClick: () => void; disabled: boolean; fill: boolean }) => React.ReactElement;
}) {
  return (
    <>
      {battleItemEntries(state).map((it) => (
        <Row key={it.id} fill={false} label={`${it.name} ×${it.count}`} onClick={() => onUse(it.id)} disabled={busy} />
      ))}
    </>
  );
}
