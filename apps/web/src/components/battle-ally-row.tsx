import type { BattleState } from '@aozoraquest/core';

/**
 * 味方の段 (D-PARTY-001)。主人公と仲間の名前・HP/MP を 1 人 1 行で出す。倒れた仲間は薄くする。
 * 仲間がいないとき (1 人) は描かない (主人公の HP/MP は上枠 HUD が出している)。
 */
export function BattleAllyRow({ state, hps }: {
  state: BattleState;
  /** 表示中の行の 味方ごとの HP (TurnEvent.hp.allies)。無ければ state の値。 */
  hps?: readonly number[] | undefined;
}) {
  const allies = state.allies ?? [];
  if (allies.length <= 1) return null;
  return (
    <div style={{ display: 'grid', gap: '0.15em', padding: '0.25em 0.5em', margin: '0 0 0.3em', border: '2px solid rgba(255,255,255,0.55)', borderRadius: 4, background: 'rgba(16,18,26,0.85)', fontSize: '0.78em', color: '#fff' }}>
      {allies.map((a, i) => {
        const hp = hps?.[i] ?? a.hp;
        const ratio = a.maxHp > 0 ? hp / a.maxHp : 0;
        return (
          <div key={i} data-ally style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', gap: '0.6em', opacity: hp <= 0 ? 0.4 : 1 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: ratio > 0.5 ? '#fff' : ratio > 0.25 ? '#f5c542' : '#e8566a' }}>HP {hp}/{a.maxHp}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>MP {a.mp}/{a.maxMp}</span>
          </div>
        );
      })}
    </div>
  );
}
