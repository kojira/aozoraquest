import type { BattleState } from '@aozoraquest/core';

/**
 * ねらう相手を選ぶ (D-PARTY-001)。生きている敵が 2 体以上で、「たたかう」か単体ねらいのとくぎを選んだときだけ出す。
 * 返す番号は「生きている敵の中で何番目か」(core の resolveTargets がその並びで数える)。
 */
export function BattleTargetPicker({ state, busy, Row, onPick, onCancel }: {
  state: BattleState;
  busy: boolean;
  Row: (p: { label: string; onClick: () => void; disabled: boolean; fill?: boolean }) => React.ReactNode;
  onPick: (targetIndex: number) => void;
  onCancel: () => void;
}) {
  const living = (state.enemies ?? [state.monster]).filter((e) => e.hp > 0);
  return (
    <>
      <div style={{ fontSize: '0.8em', color: 'rgba(255,255,255,0.85)', padding: '0.1em 0.2em' }}>だれを ねらう？</div>
      {living.map((e, i) => (
        <Row key={i} fill={false} label={e.name} onClick={() => onPick(i)} disabled={busy} />
      ))}
      <Row fill={false} label="もどる" onClick={onCancel} disabled={busy} />
    </>
  );
}

/** 生きている敵が 2 体以上か (選ぶ画面を出すか)。 */
export function needsTarget(state: BattleState): boolean {
  return (state.enemies ?? [state.monster]).filter((e) => e.hp > 0).length >= 2;
}
