import { ITEMS, jobDisplayName, MONSTERS_BY_ID, type BattleState, type StatGain } from '@aozoraquest/core';
import { formatGain } from './level-up-overlay';
import { MonsterSvg } from './monster-svg';
import type { BattleLevelUps } from '@/lib/battle-log';

/**
 * 野外戦闘のリザルト。DQ1 風に「暗転したマップ枠内」で完結させ、勝敗も報酬 (経験値・
 * 素材・レベルアップ等) もメッセージ枠内に出す。見出し・ボタンは置かず、どこかを
 * タップしたら自然にマップへ戻るだけ (オーナー要望 2026-07-18「勝利の文字を枠外に
 * 出すのをやめ、マップへ戻るボタンも不要、タップで戻るだけで十分」)。
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

const TEXT_SHADOW = '0 1px 3px rgba(0,0,0,0.9)';

export function BattleResultPanel({ result, onClose }: { result: WorldBattleResult; onClose: () => void }) {
  const { state, movedToTown, drops, xp, saveFailed } = result;
  const win = state.outcome === 'win';
  return (
    // どこをタップしてもマップへ戻る (ボタン・戻る促しは置かない = 情報量を減らす)。
    // 決着ログ (「〜をたおした！」) は直前のメッセージ窓で読ませ済みなので、ここは
    // 報酬 (経験値・素材・レベルアップ) だけを出す。将来パネル内にリンク等を足す場合は
    // その要素で e.stopPropagation() する (今は子に操作要素が無いので素通しで安全)。
    <div onClick={onClose} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: '#fff', cursor: 'pointer' }}>
      {/* 上段: たおした敵 (勝利なら反転+半透明)。小さめにして報酬枠を広く取る */}
      <div style={{ textAlign: 'center', flex: '0 0 auto' }}>
        <div style={{ opacity: win ? 0.45 : 1, display: 'inline-block', transform: win ? 'rotate(180deg)' : 'none' }}>
          <MonsterSvg species={MONSTERS_BY_ID[state.monsterId]?.species ?? 'slime'} size={60} />
        </div>
      </div>

      {/* 中段: 報酬をメッセージ枠内に。行数が多ければ枠内スクロール */}
      <div
        aria-live="polite"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          margin: '0.4em 0 0',
          padding: '0.5em 0.7em',
          border: '2px solid rgba(255,255,255,0.35)',
          borderRadius: 4,
          background: 'rgba(20,22,30,0.72)',
          fontSize: '0.85em',
          lineHeight: 1.6,
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.15em',
          textShadow: TEXT_SHADOW,
        }}
      >
        {xp > 0 && <div>経験値 +{xp}</div>}
        {result.levelUps?.player && (
          <div style={{ color: '#7ee08f', fontWeight: 700 }}>レベルが {result.levelUps.player.to} に あがった!</div>
        )}
        {result.levelUps?.job && (
          <div style={{ color: '#7ee08f', fontWeight: 700 }}>
            {jobDisplayName(result.levelUps.job.archetype, 'default')}のジョブレベルが {result.levelUps.job.to} に あがった!
          </div>
        )}
        {result.statGains && result.statGains.length > 0 && (
          <div style={{ color: 'rgba(255,255,255,0.8)' }}>{result.statGains.map((g) => `${g.label} +${formatGain(g.delta)}`).join('、')}</div>
        )}
        {drops.length > 0 && <div>素材を手に入れた: {drops.map((d) => ITEMS[d]?.name ?? d).join('、')}</div>}
        {result.materialsLost.length > 0 && (
          <div style={{ color: '#ff8a9b' }}>
            たおれたひょうしに 素材を落としてしまった…:{' '}
            {(() => {
              const counts = new Map<string, number>();
              for (const d of result.materialsLost) counts.set(d, (counts.get(d) ?? 0) + 1);
              return [...counts.entries()].map(([d, n]) => `${ITEMS[d]?.name ?? d}${n > 1 ? ` ×${n}` : ''}`).join('、');
            })()}
          </div>
        )}
        {state.outcome === 'fled' && <div style={{ color: 'rgba(255,255,255,0.7)' }}>なにも手に入らなかったが、ぶじに逃げのびた。(つかったパワーは戻らない)</div>}
        {movedToTown && <div>気がつくと「{movedToTown}」で介抱されていた… (全回復)</div>}
        {saveFailed && (
          <div style={{ color: '#ff8a9b' }}>
            ※ 結果の保存に失敗した (通信エラー)。この 1 戦は記録上「敗北」のまま残り、素材を落とした扱いになることがある。電波のよい場所で開き直すと在庫に反映される。
          </div>
        )}
      </div>
    </div>
  );
}
