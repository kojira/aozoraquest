import type { BattleState } from '@aozoraquest/core';
import { MONSTERS_BY_ID } from '@aozoraquest/core';
import { MonsterSvg } from './monster-svg';
import { HpBar } from './battle-view';

/**
 * 群れの敵の段 (D-PARTY-001)。最大 3 体を横に並べ、名前・HP バー (見抜ける職だけ)・倒れたら薄く・被弾の揺れを出す。
 * 1 体のときは BattleFieldEnemy (従来の大きな 1 体) を使うので、ここは 2 体以上のときだけ描く。
 */
export function BattleEnemyRow({ state, hps, hitKeys, showEnemyVitals }: {
  state: BattleState;
  /** 表示中の行の 敵ごとの HP。 */
  hps: readonly number[];
  /** 表示中の行で 被弾した敵の key (行ごとに揺れを出し直す)。 */
  hitKeys: ReadonlyArray<string | undefined>;
  showEnemyVitals: boolean;
}) {
  const enemies = state.enemies ?? [state.monster];
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: '0.4em' }}>
      {enemies.map((e, i) => {
        const def = MONSTERS_BY_ID[e.monsterId ?? state.monsterId];
        const hp = hps[i] ?? e.hp;
        const down = hp <= 0;
        return (
          <div key={i} data-enemy style={{ flex: '1 1 0', minWidth: 0, maxWidth: 140, textAlign: 'center', opacity: down ? 0.35 : 1, transition: 'opacity 300ms ease' }}>
            <div key={hitKeys[i] ?? state.turn} className={!down && hitKeys[i] ? 'trial-hit' : ''} style={{ display: 'inline-block' }}>
              <MonsterSvg species={def?.species ?? ''} tint={def?.tint} size={60} monsterId={e.monsterId ?? state.monsterId} />
            </div>
            {showEnemyVitals && !down ? (
              <HpBar name={e.name} hp={hp} maxHp={e.maxHp} labelColor="#fff" />
            ) : (
              <div style={{ fontSize: '0.78em', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.9)', marginTop: '0.2em', overflowWrap: 'anywhere' }}>{e.name}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
