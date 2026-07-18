import { useState } from 'react';
import type { BattleState, Command } from '@aozoraquest/core';
import { BATTLE_TUNING, MONSTERS_BY_ID } from '@aozoraquest/core';
import { MonsterSvg } from './monster-svg';
import { HpBar, TypedLines } from './battle-view';

/**
 * あおぞらワールドの戦闘 UI (DQ 風の配置。オーナー要望 2026-07-18)。
 *  - フィールドに敵スプライト (名前・数は右ペイン、体力は見抜ける職業のみ)。
 *  - input: 下段左右 2 ペイン (左=コマンド 2 列 / 右=敵リスト or どうぐの中身)。
 *  - message/result: コマンドを消して全幅メッセージ窓 (タップ送り)。
 * **下段は常に同じ固定高さ (4 行)** にして、フェーズが変わってもフィールドの敵の
 * 位置がずれない / メッセージ枠が伸縮しない (認知負荷を下げる — オーナー指摘)。
 * DQ の作法どおりメッセージ枠は 4 行分。
 */
export type BattlePhase = 'message' | 'input' | 'result';

/** 下段 (コマンド窓 / メッセージ窓) の固定高さ = メッセージ 4 行 + 余白。全フェーズ共通。 */
const BOTTOM_H = '7em';
const WINDOW: React.CSSProperties = {
  border: '2px solid rgba(255,255,255,0.55)',
  borderRadius: 4,
  background: 'rgba(16,18,26,0.85)',
};
const TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.9)';

export function WorldBattleControls({
  state,
  phase,
  busy,
  showEnemyVitals,
  resultLines,
  onCommand,
  onAdvance,
}: {
  state: BattleState;
  phase: BattlePhase;
  /** 支払い等の処理中はメッセージ送りを止める (二重確定防止) */
  busy: boolean;
  showEnemyVitals: boolean;
  /** result フェーズで出す報酬行 (経験値・素材など)。message/input では未使用。 */
  resultLines: readonly string[];
  onCommand: (c: Command) => void;
  onAdvance: () => void;
}) {
  const [itemMenu, setItemMenu] = useState(false);
  const monsterDef = MONSTERS_BY_ID[state.monsterId];
  const messageLines =
    phase === 'result'
      ? resultLines
      : state.turn === 0
        ? [`${state.monster.name}が あらわれた！ ${monsterDef?.intro ?? ''}`]
        : state.lastEvents.map((e) => e.text);
  return (
    <>
      {/* フィールド: 敵スプライト (+ 見抜ける職業のみ体力)。下段が固定高さなので
          ここ (flex:1) の高さも一定 = 敵の位置がフェーズで動かない。 */}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <BattleFieldEnemy state={state} showEnemyVitals={showEnemyVitals} defeated={phase === 'result' && state.outcome === 'win'} />
      </div>

      {/* 下段: 常に BOTTOM_H の固定高さ */}
      <div style={{ flex: `0 0 ${BOTTOM_H}`, height: BOTTOM_H }}>
        {phase === 'input' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4em', height: '100%' }}>
            {/* 左: コマンド (2 列 3 行に詰める = 4 行メッセージ枠と同じ高さに収める) */}
            <div style={{ ...WINDOW, height: '100%', padding: '0.2em 0.3em', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'repeat(3, 1fr)', gridAutoFlow: 'column', columnGap: '0.2em' }}>
              <DqRow label="たたかう" onClick={() => onCommand('attack')} disabled={busy || itemMenu} />
              <DqRow label={state.playerSkill.name} onClick={() => onCommand('skill')} disabled={busy || itemMenu || state.player.mp < BATTLE_TUNING.skillMpCost} />
              <DqRow label="ぼうぎょ" onClick={() => onCommand('guard')} disabled={busy || itemMenu} />
              {/* どうぐ: 再タップで閉じる (DQ の戻る慣習) */}
              <DqRow label="どうぐ" onClick={() => setItemMenu((v) => !v)} disabled={busy || (state.herbs <= 0 && state.tonics <= 0)} cursor={itemMenu} />
              <DqRow label="にげる" onClick={() => onCommand('flee')} disabled={busy || itemMenu} />
            </div>
            {/* 右: どうぐ選択中はアイテム、それ以外は敵リスト */}
            <div style={{ ...WINDOW, height: '100%', padding: '0.2em 0.4em', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              {itemMenu ? (
                <>
                  <DqRow label={`やくそう ×${state.herbs}`} onClick={() => { setItemMenu(false); onCommand('herb'); }} disabled={busy || state.herbs <= 0 || state.player.hp >= state.player.maxHp} />
                  <DqRow label={`そらのしずく ×${state.tonics}`} onClick={() => { setItemMenu(false); onCommand('tonic'); }} disabled={busy || state.tonics <= 0 || state.player.mp >= state.player.maxMp} />
                  <DqRow label="もどる" onClick={() => setItemMenu(false)} disabled={busy} />
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', fontSize: '0.9em', textShadow: TEXT_SHADOW }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.monster.name}</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.85, flex: '0 0 auto', marginLeft: '0.3em' }}>1ぴき</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          // message / result: 全幅メッセージ窓 (固定 4 行高さ = 下段と同じ)
          <DqMessageWindow key={`${phase}-${state.turn}`} lines={messageLines} busy={busy} onAdvance={onAdvance} />
        )}
      </div>
    </>
  );
}

/** 敵スプライト + 見抜ける職業のみ体力 (名前・数は右ペインなのでここには出さない)。 */
function BattleFieldEnemy({ state, showEnemyVitals, defeated }: { state: BattleState; showEnemyVitals: boolean; defeated: boolean }) {
  const monsterDef = MONSTERS_BY_ID[state.monsterId];
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        key={state.turn}
        style={{ display: 'inline-block', opacity: defeated ? 0.35 : 1, transform: defeated ? 'rotate(180deg)' : 'none', transition: 'opacity 300ms ease' }}
        className={!defeated && state.lastEvents.some((e) => e.actor === 'player' && e.damage) ? 'trial-hit' : ''}
      >
        <MonsterSvg species={monsterDef?.species ?? 'slime'} size={84} />
      </div>
      {showEnemyVitals && !defeated && (
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

/** DQ 風コマンド窓の 1 行 (styles.css の .dq-command)。2 列グリッド内では minHeight を
 *  0 にして行がセル高さに合う (固定高さの下段に 3 行を等分)。 */
function DqRow({ label, onClick, disabled, cursor = false }: { label: string; onClick: () => void; disabled: boolean; cursor?: boolean }) {
  return (
    <button type="button" className="dq-command" onClick={onClick} disabled={disabled} style={{ width: '100%', minHeight: 0 }}>
      {cursor ? `▸ ${label}` : label}
    </button>
  );
}

/** 全幅メッセージ窓 (固定 4 行高さ)。タップで「1 回目=全文 / 2 回目=送り」。 */
function DqMessageWindow({ lines, busy, onAdvance }: { lines: readonly string[]; busy: boolean; onAdvance: () => void }) {
  const [typed, setTyped] = useState(false);
  return (
    <div
      className="dq-message"
      onClick={() => {
        if (busy) return; // 処理中は送らない
        if (typed) onAdvance(); // 全文表示済み → 送り (まだタイプ中なら TypedLines が全文化)
      }}
      style={{
        ...WINDOW,
        height: '100%',
        overflowY: 'auto',
        padding: '0.4em 0.7em',
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
