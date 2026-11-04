import type { BattleState } from '@aozoraquest/core';

const mono = { fontFamily: 'ui-monospace, monospace' } as const;

/** 数字のすぐ下に細いバーを重ねる (行の高さを増やさない)。色は HP バー (battle-view の HpBar) と同じ しきい値。 */
function Gauge({ kind, label, value, max, textColor, barColor }: { kind: 'hp' | 'mp'; label: string; value: number; max: number; textColor: string; barColor: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span style={{ position: 'relative', paddingBottom: 3, ...mono, color: textColor }}>
      {label} {value}/{max}
      <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'var(--color-track-bg)', overflow: 'hidden' }}>
        <span data-bar={kind} style={{ display: 'block', width: `${ratio * 100}%`, height: '100%', background: barColor, transition: 'width 300ms ease' }} />
      </span>
    </span>
  );
}

/**
 * 味方の段 (D-PARTY-001)。主人公と仲間の名前・HP/MP の数字とバーを 1 人 1 行で出す。倒れた仲間は薄くする。
 * バーは数字のすぐ下に重ね、行は詰める (390px の戦闘枠に 4 行と敵の段がおさまるように)。
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
    <div style={{ display: 'grid', gap: 1, padding: '0.1em 0.5em', margin: '0 0 0.2em', lineHeight: 1.15, border: '1px solid rgba(255,255,255,0.55)', borderRadius: 4, background: 'rgba(16,18,26,0.85)', fontSize: '0.78em', color: '#fff' }}>
      {allies.map((a, i) => {
        const hp = hps?.[i] ?? a.hp;
        const ratio = a.maxHp > 0 ? hp / a.maxHp : 0;
        return (
          <div key={i} data-ally style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', gap: '0.6em', opacity: hp <= 0 ? 0.4 : 1 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
            <Gauge kind="hp" label="HP" value={hp} max={a.maxHp} textColor={ratio > 0.5 ? '#fff' : ratio > 0.25 ? '#f5c542' : '#e8566a'} barColor={ratio > 0.5 ? '#5fc37e' : ratio > 0.25 ? '#f5c542' : '#e8566a'} />
            <Gauge kind="mp" label="MP" value={a.mp} max={a.maxMp} textColor="#fff" barColor="#8ab6f0" />
          </div>
        );
      })}
    </div>
  );
}
