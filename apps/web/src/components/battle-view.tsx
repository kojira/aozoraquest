import type { BattleState, Command, TurnEvent } from '@aozoraquest/core';
import { BATTLE_TUNING, MONSTERS_BY_ID, SKILL_KIND_LABELS } from '@aozoraquest/core';
import { MonsterSvg } from './monster-svg';

/**
 * バトル画面の純表示コンポーネント (docs/18-brusukon-trial.md)。
 * 「state を描いてコマンドを送るだけ」の薄いレンダラーで、ブルスコンの試練
 * (trial-arena) と あおぞらワールドの野外遭遇 (world) の両方から使う。
 * PR-W4 でサーバー権威バトルになっても、このコンポーネントはそのまま
 * (state がサーバー応答になるだけ)。
 */
export function BattleView({
  state,
  busy,
  onCommand,
  headerNote,
}: {
  state: BattleState;
  busy: boolean;
  onCommand: (c: Command) => void;
  /** 敵の上に出す小さな注記 (試練の tier 表示など) */
  headerNote?: string | undefined;
}) {
  const monsterDef = MONSTERS_BY_ID[state.monsterId];
  return (
    <div>
      {/* 敵エリア。key=turn で再マウントして被弾シェイクを毎ターン再生する
          (class 文字列が同じままだと CSS アニメは再始動しない)。 */}
      <div style={{ textAlign: 'center', paddingTop: '0.4em' }}>
        {headerNote && (
          <div style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{headerNote}</div>
        )}
        <div
          key={state.turn}
          style={{ display: 'inline-block' }}
          className={state.lastEvents.some((e) => e.actor === 'player' && e.damage) ? 'trial-hit' : ''}
        >
          <MonsterSvg species={monsterDef?.species ?? 'slime'} size={150} />
        </div>
        <HpBar name={state.monster.name} hp={state.monster.hp} maxHp={state.monster.maxHp} />
      </div>

      {/* ログ。1 ターン分だけ表示するので高さは内容に応じて伸ばす
          (固定高 + 末尾スクロールだと冒頭行が隠れて経緯が読めない)。 */}
      <div
        style={{
          margin: '0.7em 0',
          padding: '0.5em 0.7em',
          border: '2px solid var(--color-border)',
          borderRadius: 4,
          background: 'var(--color-window-bg)',
          minHeight: '4.5em',
          fontSize: '0.85em',
          lineHeight: 1.6,
        }}
      >
        {state.turn === 0 ? (
          <div>
            {state.monster.name}があらわれた! {monsterDef?.intro}
          </div>
        ) : (
          state.lastEvents.map((e: TurnEvent, i: number) => <div key={i}>{e.text}</div>)
        )}
      </div>

      {/* 自分 HP + MP */}
      <HpBar name={state.player.name} hp={state.player.hp} maxHp={state.player.maxHp} mine />
      <MpBar mp={state.player.mp} maxMp={state.player.maxMp} />

      {/* コマンド (親指ゾーン、2x3)。特技は MP、どうぐは残数で使用可否が決まる。 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5em', marginTop: '0.8em' }}>
        <CommandButton label="たたかう" sub={`MP +${BATTLE_TUNING.mpAttackGain}`} onClick={() => onCommand('attack')} disabled={busy} />
        <CommandButton
          label={state.playerSkill.name}
          sub={`MP ${BATTLE_TUNING.skillMpCost} / ${SKILL_KIND_LABELS[state.playerSkill.kind].split(' ')[0]}`}
          onClick={() => onCommand('skill')}
          disabled={busy || state.player.mp < BATTLE_TUNING.skillMpCost}
        />
        <CommandButton
          label="ぼうぎょ"
          sub={`回避↑ / MP +${BATTLE_TUNING.mpGuardGain}`}
          onClick={() => onCommand('guard')}
          disabled={busy}
        />
        <CommandButton
          label={`やくそう ×${state.herbs}`}
          sub={`HP ${Math.round(BATTLE_TUNING.herbHealRatio * 100)}% 回復`}
          onClick={() => onCommand('herb')}
          disabled={busy || state.herbs <= 0 || state.player.hp >= state.player.maxHp}
        />
        <CommandButton
          label={`そらのしずく ×${state.tonics}`}
          sub={`MP ${Math.round(BATTLE_TUNING.tonicMpRatio * 100)}% 回復`}
          onClick={() => onCommand('tonic')}
          disabled={busy || state.tonics <= 0 || state.player.mp >= state.player.maxMp}
        />
        <CommandButton
          label="にげる"
          sub="失敗するとスキを見せる"
          onClick={() => onCommand('flee')}
          disabled={busy}
        />
      </div>
    </div>
  );
}

export function HpBar({ name, hp, maxHp, mine = false }: { name: string; hp: number; maxHp: number; mine?: boolean }) {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const color = ratio > 0.5 ? '#5fc37e' : ratio > 0.25 ? '#f5c542' : '#e8566a';
  return (
    <div style={{ maxWidth: 340, margin: '0.3em auto 0', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78em' }}>
        <span>{mine ? `▶ ${name}` : name}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{hp} / {maxHp}</span>
      </div>
      <div style={{ height: 8, background: 'var(--color-track-bg)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${ratio * 100}%`, height: '100%', background: color, transition: 'width 300ms ease' }} />
      </div>
    </div>
  );
}

export function MpBar({ mp, maxMp }: { mp: number; maxMp: number }) {
  const ratio = maxMp > 0 ? mp / maxMp : 0;
  return (
    <div style={{ maxWidth: 340, margin: '0.25em auto 0', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72em', color: 'var(--color-muted)' }}>
        <span>MP</span>
        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{mp} / {maxMp}</span>
      </div>
      <div style={{ height: 6, background: 'var(--color-track-bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${ratio * 100}%`, height: '100%', background: '#5a9ae8', transition: 'width 300ms ease' }} />
      </div>
    </div>
  );
}

export function CommandButton({ label, sub, onClick, disabled }: { label: string; sub?: string | undefined; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '0.8em 0.2em',
        fontSize: '0.9em',
        lineHeight: 1.3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.1em',
        minHeight: '3.6em',
        touchAction: 'manipulation',
      }}
    >
      <span>{label}</span>
      {sub && <span style={{ fontSize: '0.68em', color: 'var(--color-muted)' }}>{sub}</span>}
    </button>
  );
}
