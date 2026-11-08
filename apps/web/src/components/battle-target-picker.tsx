import type { BattleState, Combatant } from '@aozoraquest/core';

/**
 * ねらう相手を選ぶ (D-PARTY-001)。生きている敵が 2 体以上で、「たたかう」か単体ねらいのとくぎを選んだときだけ出す。
 * 返す番号は「生きている敵の中で何番目か」(core の resolveTargets がその並びで数える)。
 * side='ally' は味方を選ぶ (回復のとくぎ・やくそうなど。D-PARTY-003): 生きている味方 (主人公を含む) を並べ、
 * 「生きている味方の中で何番目か」を返す。full の人 (満タンで効かない) は押せない。
 */
export function BattleTargetPicker({ state, busy, Row, onPick, onCancel, side = 'enemy', full }: {
  state: BattleState;
  busy: boolean;
  Row: (p: { label: string; onClick: () => void; disabled: boolean; fill?: boolean }) => React.ReactNode;
  onPick: (targetIndex: number) => void;
  onCancel: () => void;
  side?: 'enemy' | 'ally';
  full?: (c: Combatant) => boolean;
}) {
  const living = side === 'ally' ? livingAllies(state) : (state.enemies ?? [state.monster]).filter((e) => e.hp > 0);
  return (
    <>
      <div style={{ fontSize: '0.8em', color: 'rgba(255,255,255,0.85)', padding: '0.1em 0.2em' }}>{side === 'ally' ? 'だれを かいふくする？' : 'だれを ねらう？'}</div>
      {living.map((e, i) => (
        <Row key={i} fill={false} label={e.name} onClick={() => onPick(i)} disabled={busy || !!full?.(e)} />
      ))}
      {/* 窓は固定の高さでスクロールする。敵が 2 体以上だと 390px で「もどる」が下で切れるので、下に張りつける。 */}
      <div data-picker-back style={{ position: 'sticky', bottom: 0, flexShrink: 0, background: 'rgba(16,18,26,0.95)' }}>
        <Row fill={false} label="もどる" onClick={onCancel} disabled={busy} />
      </div>
    </>
  );
}

/** 生きている敵が 2 体以上か (選ぶ画面を出すか)。 */
export function needsTarget(state: BattleState): boolean {
  return (state.enemies ?? [state.monster]).filter((e) => e.hp > 0).length >= 2;
}

/** 生きている味方 (主人公を含む・並びは allies の順)。1 人戦は主人公だけ。 */
export function livingAllies(state: BattleState): Combatant[] {
  return (state.allies ?? [state.player]).filter((a) => a.hp > 0);
}

/** 生きている味方が 2 人以上か (回復の相手を選ぶ画面を出すか。D-PARTY-003)。 */
export function needsAllyTarget(state: BattleState): boolean {
  return livingAllies(state).length >= 2;
}
