import { ITEMS, withCharacterNames, type BattleState } from '@aozoraquest/core';

/**
 * 戦闘の「どうぐ」に並べる戦闘用のどうぐ (D-ITEM-001)。数は封印した state.battleItems。
 * 0 個の品は出さない。単体の敵をねらう品で生きている敵が 2 体以上なら、ねらう相手を選ぶ (world-battle-controls)。
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
