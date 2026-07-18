import { ITEMS, jobDisplayName, type BattleState, type StatGain } from '@aozoraquest/core';
import { formatGain } from './level-up-overlay';
import type { BattleLevelUps } from '@/lib/battle-log';

/**
 * 野外戦闘のリザルト (マップ下に出す。敵と勝敗はマップ枠内の暗転シーン側で表示)。
 * ページ遷移せず「マップのサイズ上で戦闘を完結させる」ため BattleView から切り出した。
 */
export interface WorldBattleResult {
  state: BattleState;
  movedToTown: string | null;
  drops: string[];
  xp: number;
  saveFailed: boolean;
  levelUps?: BattleLevelUps;
  statGains?: StatGain[];
  materialsLost: string[];
}

export function BattleResultPanel({ result, onClose }: { result: WorldBattleResult; onClose: () => void }) {
  const { state, movedToTown, drops, xp, saveFailed } = result;
  return (
    <div style={{ textAlign: 'center', marginTop: '0.4em' }}>
      <div aria-live="polite" style={{ margin: '0.2em 0', fontSize: '0.88em', display: 'flex', flexDirection: 'column', gap: '0.2em' }}>
        {xp > 0 && <div>経験値 +{xp}</div>}
        {result.levelUps?.player && (
          <div style={{ color: 'var(--color-accent)', fontWeight: 700 }}>レベルが {result.levelUps.player.to} に あがった!</div>
        )}
        {result.levelUps?.job && (
          <div style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
            {jobDisplayName(result.levelUps.job.archetype, 'default')}のジョブレベルが {result.levelUps.job.to} に あがった!
          </div>
        )}
        {result.statGains && result.statGains.length > 0 && (
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
            {result.statGains.map((g) => `${g.label} +${formatGain(g.delta)}`).join('、')}
          </div>
        )}
        {drops.length > 0 && <div>素材を手に入れた: {drops.map((d) => ITEMS[d]?.name ?? d).join('、')}</div>}
        {saveFailed && (
          <div style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>
            ※ 結果の保存に失敗した (通信エラー)。この 1 戦は記録上「敗北」のまま残り、素材を落とした扱いになることがある。電波のよい場所で開き直すと在庫に反映される。
          </div>
        )}
      </div>
      {result.materialsLost.length > 0 && (
        <div style={{ margin: '0.3em 0', fontSize: '0.88em', color: 'var(--color-danger)' }}>
          たおれたひょうしに 素材を落としてしまった…:{' '}
          {(() => {
            const counts = new Map<string, number>();
            for (const d of result.materialsLost) counts.set(d, (counts.get(d) ?? 0) + 1);
            return [...counts.entries()].map(([d, n]) => `${ITEMS[d]?.name ?? d}${n > 1 ? ` ×${n}` : ''}`).join('、');
          })()}
        </div>
      )}
      {state.outcome === 'fled' && (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>なにも手に入らなかったが、ぶじに逃げのびた。(つかったパワーは戻らない)</p>
      )}
      {movedToTown && <p style={{ fontSize: '0.85em' }}>気がつくと「{movedToTown}」で介抱されていた… (全回復)</p>}
      <button type="button" onClick={onClose} style={{ padding: '0.7em 1.6em', marginTop: '0.3em' }}>
        マップへ戻る
      </button>
    </div>
  );
}
