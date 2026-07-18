import { useState } from 'react';
import type { BattleState, Command } from '@aozoraquest/core';
import { BATTLE_TUNING, MONSTERS_BY_ID } from '@aozoraquest/core';
import { MonsterSvg } from './monster-svg';
import { HpBar, TypedLines } from './battle-view';

/**
 * あおぞらワールドの戦闘 UI (DQ 風の配置。オーナー要望 2026-07-18)。
 *  - フィールドに敵スプライト (敵の名前・数は右ペインへ、体力は見抜ける職業のみ)。
 *  - コマンド入力中: 下段を左右 2 ペイン (左=コマンド / 右=敵リスト or どうぐの中身)。
 *  - メッセージ表示中: コマンドを消して全幅メッセージ窓 (タップで送り)。
 * 情報量は最小に (自明なヒントは出さない — [[feedback_reduce_ui_info]])。
 */
export type BattlePhase = 'message' | 'input';

const WINDOW: React.CSSProperties = {
  border: '2px solid rgba(255,255,255,0.6)',
  borderRadius: 4,
  background: 'rgba(16,18,26,0.85)',
};
const TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.9)';

export function WorldBattleControls({
  state,
  phase,
  busy,
  showEnemyVitals,
  onCommand,
  onAdvance,
}: {
  state: BattleState;
  phase: BattlePhase;
  /** 支払い等の処理中はメッセージ送りを止める (二重確定防止) */
  busy: boolean;
  showEnemyVitals: boolean;
  onCommand: (c: Command) => void;
  onAdvance: () => void;
}) {
  const [itemMenu, setItemMenu] = useState(false);
  return (
    <>
      {/* フィールド: 敵スプライト (+ 見抜ける職業のみ体力) */}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <BattleFieldEnemy state={state} showEnemyVitals={showEnemyVitals} />
      </div>

      {phase === 'message' ? (
        <DqMessageWindow key={`${state.turn}`} state={state} busy={busy} onAdvance={onAdvance} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '5fr 6fr', gap: '0.4em', flex: '0 0 auto', alignItems: 'start' }}>
          {/* 左: コマンド */}
          <div style={{ ...WINDOW, padding: '0.15em 0.4em' }}>
            <DqRow label="たたかう" onClick={() => onCommand('attack')} disabled={busy || itemMenu} />
            <DqRow label={state.playerSkill.name} onClick={() => onCommand('skill')} disabled={busy || itemMenu || state.player.mp < BATTLE_TUNING.skillMpCost} />
            <DqRow label="ぼうぎょ" onClick={() => onCommand('guard')} disabled={busy || itemMenu} />
            <DqRow label="どうぐ" onClick={() => setItemMenu(true)} disabled={busy || (state.herbs <= 0 && state.tonics <= 0)} cursor={itemMenu} />
            <DqRow label="にげる" onClick={() => onCommand('flee')} disabled={busy || itemMenu} />
          </div>
          {/* 右: どうぐ選択中はアイテム、それ以外は敵リスト */}
          <div style={{ ...WINDOW, padding: '0.15em 0.4em', minHeight: '2.6em' }}>
            {itemMenu ? (
              <>
                <DqRow
                  label={`やくそう ×${state.herbs}`}
                  onClick={() => { setItemMenu(false); onCommand('herb'); }}
                  disabled={busy || state.herbs <= 0 || state.player.hp >= state.player.maxHp}
                />
                <DqRow
                  label={`そらのしずく ×${state.tonics}`}
                  onClick={() => { setItemMenu(false); onCommand('tonic'); }}
                  disabled={busy || state.tonics <= 0 || state.player.mp >= state.player.maxMp}
                />
                <DqRow label="もどる" onClick={() => setItemMenu(false)} disabled={busy} />
              </>
            ) : (
              <EnemyList state={state} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** 敵スプライト + 見抜ける職業のみ体力 (名前・数は右ペインなのでここには出さない)。 */
function BattleFieldEnemy({ state, showEnemyVitals }: { state: BattleState; showEnemyVitals: boolean }) {
  const monsterDef = MONSTERS_BY_ID[state.monsterId];
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        key={state.turn}
        style={{ display: 'inline-block' }}
        className={state.lastEvents.some((e) => e.actor === 'player' && e.damage) ? 'trial-hit' : ''}
      >
        <MonsterSvg species={monsterDef?.species ?? 'slime'} size={84} />
      </div>
      {showEnemyVitals && (
        <>
          <HpBar name={state.monster.name} hp={state.monster.hp} maxHp={state.monster.maxHp} labelColor="#fff" />
          {monsterDef?.ability && state.monster.maxMp > 0 && (() => {
            const cost = monsterDef.ability === 'healer' ? BATTLE_TUNING.monsterHealMpCost : BATTLE_TUNING.monsterChargeMpCost;
            const total = Math.max(1, Math.floor(state.monster.maxMp / cost));
            const left = Math.floor(state.monster.mp / cost);
            const color = monsterDef.ability === 'healer' ? '#5fc37e' : '#e8802e';
            return (
              <div style={{ maxWidth: 340, margin: '0.15em auto 0', display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: '0.68em', color: 'rgba(255,255,255,0.8)', textShadow: TEXT_SHADOW }}>
                  {monsterDef.ability === 'healer' ? 'かいふく' : 'ため'} あと{left}
                </span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: Math.min(total, 6) }, (_, i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i < left ? color : 'rgba(0,0,0,0.35)', border: i < left ? 'none' : '1px solid rgba(255,255,255,0.25)' }} />
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

/** 右ペインの敵リスト (名前 + 数)。単一敵なので今は 1 種類 1 匹。 */
function EnemyList({ state }: { state: BattleState }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', fontSize: '0.9em', padding: '0.45em 0.1em', textShadow: TEXT_SHADOW }}>
      <span>{state.monster.name}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.85 }}>1ぴき</span>
    </div>
  );
}

/** DQ 風コマンド窓の 1 行 (styles.css の .dq-command で見た目・押下感を持つ)。 */
function DqRow({ label, onClick, disabled, cursor = false }: { label: string; onClick: () => void; disabled: boolean; cursor?: boolean }) {
  return (
    <button type="button" className="dq-command" onClick={onClick} disabled={disabled} style={{ width: '100%' }}>
      {cursor ? `▸ ${label}` : label}
    </button>
  );
}

/** 全幅メッセージ窓。タップで「1 回目=全文表示 / 2 回目=送り (onAdvance)」。 */
function DqMessageWindow({ state, busy, onAdvance }: { state: BattleState; busy: boolean; onAdvance: () => void }) {
  const monsterDef = MONSTERS_BY_ID[state.monsterId];
  const lines = state.turn === 0 ? [`${state.monster.name}が あらわれた！ ${monsterDef?.intro ?? ''}`] : state.lastEvents.map((e) => e.text);
  const [typed, setTyped] = useState(false);
  return (
    <div
      onClick={() => {
        if (busy) return; // 処理中は送らない
        if (typed) onAdvance(); // 全文表示済み → 送り
        // まだタイプ中なら TypedLines 側の onClick が全文表示する
      }}
      style={{
        ...WINDOW,
        flex: '0 0 auto',
        minHeight: '3.4em',
        maxHeight: '6em',
        overflowY: 'auto',
        padding: '0.5em 0.7em',
        fontSize: '0.9em',
        lineHeight: 1.6,
        color: '#fff',
        textShadow: TEXT_SHADOW,
        cursor: 'pointer',
      }}
    >
      <TypedLines lines={lines} onDone={() => setTyped(true)} />
    </div>
  );
}
