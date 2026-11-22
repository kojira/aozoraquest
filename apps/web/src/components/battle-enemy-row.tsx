import type { BattleState } from '@aozoraquest/core';
import { MONSTERS_BY_ID } from '@aozoraquest/core';
import { MonsterSvg } from './monster-svg';

const TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.9)';

/**
 * 群れの敵の段 (D-PARTY-001・D-PARTY-005)。最大 5 体を横 1 列に並べ、名前・HP (見抜ける職だけ)・倒れたら薄く・被弾の揺れを出す。
 * 名前・HP の数字・バーは縦に積む (横に並べると 3 体で名前と数字が重なっていた)。名前は折り返す (省略しない)。
 * 4 体以上は絵と文字を小さくして、390px に 5 体が重ならずに入る。
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
  const many = enemies.length >= 4;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: many ? '0.2em' : '0.4em' }}>
      {enemies.map((e, i) => {
        const def = MONSTERS_BY_ID[e.monsterId ?? state.monsterId];
        const hp = hps[i] ?? e.hp;
        const down = hp <= 0;
        const ratio = e.maxHp > 0 ? Math.max(0, Math.min(1, hp / e.maxHp)) : 0;
        return (
          <div key={i} data-enemy style={{ flex: '1 1 0', minWidth: 0, maxWidth: 140, textAlign: 'center', opacity: down ? 0.35 : 1, transition: 'opacity 300ms ease' }}>
            <div key={hitKeys[i] ?? state.turn} className={!down && hitKeys[i] ? 'trial-hit' : ''} style={{ display: 'inline-block' }}>
              <MonsterSvg species={def?.species ?? ''} tint={def?.tint} size={many ? 44 : 60} monsterId={e.monsterId ?? state.monsterId} />
            </div>
            <div data-enemy-name style={{ fontSize: many ? '0.68em' : '0.78em', lineHeight: 1.2, color: '#fff', textShadow: TEXT_SHADOW, marginTop: '0.1em', overflowWrap: 'anywhere' }}>{e.name}</div>
            {showEnemyVitals && !down && (
              <div data-enemy-hp style={{ fontSize: many ? '0.62em' : '0.7em', color: '#fff', textShadow: TEXT_SHADOW }}>
                <div style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{hp}/{e.maxHp}</div>
                <div style={{ height: 5, background: 'var(--color-track-bg)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${ratio * 100}%`, height: '100%', background: ratio > 0.5 ? '#5fc37e' : ratio > 0.25 ? '#f5c542' : '#e8566a', transition: 'width 300ms ease' }} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
