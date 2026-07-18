import { useEffect, useMemo, useRef, useState } from 'react';
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
  return (
    <div>
      <BattleScene state={state} headerNote={headerNote} monsterSize={132} />
      <div style={{ marginTop: '0.7em' }}>
        <BattleCommands state={state} busy={busy} onCommand={onCommand} />
      </div>
    </div>
  );
}

/**
 * 敵エリア + ログ。あおぞらワールドでは「暗転したマップ枠内」に重ねて
 * DQ1 風の戦闘シーンにする (world-battle-inline)。試練では BattleView が使う。
 */
export function BattleScene({
  state,
  headerNote,
  monsterSize = 132,
  compact = false,
}: {
  state: BattleState;
  headerNote?: string | undefined;
  monsterSize?: number;
  /** 暗い背景に重ねるとき (マップ上オーバーレイ) は文字を明色にする */
  compact?: boolean;
}) {
  const monsterDef = MONSTERS_BY_ID[state.monsterId];
  const fg = compact ? '#fff' : 'var(--color-fg)';
  const shadow = compact ? '0 1px 3px rgba(0,0,0,0.9)' : undefined;
  return (
    <>
      {/* 敵エリア。key=turn で再マウントして被弾シェイクを毎ターン再生する
          (class 文字列が同じままだと CSS アニメは再始動しない)。 */}
      <div style={{ textAlign: 'center' }}>
        {headerNote && (
          <div style={{ fontSize: '0.75em', color: compact ? 'rgba(255,255,255,0.75)' : 'var(--color-muted)', textShadow: shadow }}>{headerNote}</div>
        )}
        <div
          key={state.turn}
          style={{ display: 'inline-block' }}
          className={state.lastEvents.some((e) => e.actor === 'player' && e.damage) ? 'trial-hit' : ''}
        >
          <MonsterSvg species={monsterDef?.species ?? 'slime'} size={monsterSize} />
        </div>
        <HpBar name={state.monster.name} hp={state.monster.hp} maxHp={state.monster.maxHp} {...(compact ? { labelColor: '#fff' } : {})} />
        {/* ため/回復を使う敵は「あと何回撃てるか」をセグメントで見せる (尽きたら攻める
            読み合い)。通常攻撃だけの敵は MP を使わないので出さない (混乱防止)。
            charger=赤系 / healer=緑系 で脅威の種別を色で区別。 */}
        {monsterDef?.ability && state.monster.maxMp > 0 && (() => {
          const cost = monsterDef.ability === 'healer' ? BATTLE_TUNING.monsterHealMpCost : BATTLE_TUNING.monsterChargeMpCost;
          const total = Math.max(1, Math.floor(state.monster.maxMp / cost));
          const left = Math.floor(state.monster.mp / cost);
          const color = monsterDef.ability === 'healer' ? '#5fc37e' : '#e8802e';
          return (
            <div style={{ maxWidth: 340, margin: '0.15em auto 0', display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
              <span style={{ fontSize: '0.68em', color: compact ? 'rgba(255,255,255,0.8)' : 'var(--color-muted)', textShadow: shadow }}>
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
      </div>

      {/* ログ (DQ1 風に 1 文字ずつ表示、key=turn で毎ターン打ち直す。コマンドは
          ブロックしない = テンポ優先)。暗転背景では半透明の暗パネルに白文字。 */}
      <div
        style={{
          margin: compact ? '0.5em 0 0' : '0.7em 0',
          padding: '0.5em 0.7em',
          border: `2px solid ${compact ? 'rgba(255,255,255,0.35)' : 'var(--color-border)'}`,
          borderRadius: 4,
          background: compact ? 'rgba(20,22,30,0.72)' : 'var(--color-window-bg)',
          minHeight: '3.6em',
          ...(compact ? { maxHeight: '6em', overflowY: 'auto' as const } : {}),
          fontSize: '0.85em',
          lineHeight: 1.6,
          color: fg,
          textShadow: shadow,
        }}
      >
        <TypedLines
          key={state.turn}
          lines={
            state.turn === 0
              ? [`${state.monster.name}があらわれた! ${monsterDef?.intro ?? ''}`]
              : state.lastEvents.map((e: TurnEvent) => e.text)
          }
        />
      </div>
    </>
  );
}

/** 自分 HP/MP + コマンド (親指ゾーン、2x3)。 */
export function BattleCommands({
  state,
  busy,
  onCommand,
  compact = false,
}: {
  state: BattleState;
  busy: boolean;
  onCommand: (c: Command) => void;
  compact?: boolean;
}) {
  return (
    <div>
      <HpBar name={state.player.name} hp={state.player.hp} maxHp={state.player.maxHp} mine {...(compact ? { labelColor: '#fff' } : {})} />
      <MpBar mp={state.player.mp} maxMp={state.player.maxMp} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5em', marginTop: '0.6em' }}>
        <CommandButton
          label="たたかう"
          sub={state.mpAttackGain > 0 ? `MP +${state.mpAttackGain}${state.mpTraitName ? ` (${state.mpTraitName})` : ''}` : undefined}
          onClick={() => onCommand('attack')}
          disabled={busy}
        />
        <CommandButton
          label={state.playerSkill.name}
          sub={`MP ${BATTLE_TUNING.skillMpCost} / ${SKILL_KIND_LABELS[state.playerSkill.kind].split(' ')[0]}`}
          onClick={() => onCommand('skill')}
          disabled={busy || state.player.mp < BATTLE_TUNING.skillMpCost}
        />
        <CommandButton
          label="ぼうぎょ"
          sub={state.mpGuardGain > 0 ? `回避↑ / MP +${state.mpGuardGain}` : '回避↑'}
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
          sub="失敗すると 1 ターン失う"
          onClick={() => onCommand('flee')}
          disabled={busy}
        />
      </div>
    </div>
  );
}

export function HpBar({ name, hp, maxHp, mine = false, labelColor }: { name: string; hp: number; maxHp: number; mine?: boolean; labelColor?: string }) {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const color = ratio > 0.5 ? '#5fc37e' : ratio > 0.25 ? '#f5c542' : '#e8566a';
  const textShadow = labelColor ? '0 1px 2px rgba(0,0,0,0.9)' : undefined;
  return (
    <div style={{ maxWidth: 340, margin: '0.3em auto 0', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78em', color: labelColor, textShadow }}>
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

/** 戦闘ログの DQ1 風タイプライター表示。行を順に 1 文字ずつ出す。
 *  reduced-motion では即時全文。セリフウィンドウ (dialogue-window) より速い
 *  1 文字 22ms — 戦闘のテンポを削らない速度に留める。battle-view 専用。 */
function TypedLines({ lines }: { lines: readonly string[] }) {
  const reduced = useMemo(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  // lines は毎レンダー新配列 (map で生成) なので、打ち直しの契機は内容文字列で
  // 判定する — 親 (World) の notice 更新等の無関係な再レンダーで頭から
  // タイプし直さない (レビュー指摘)
  const joined = lines.join('\n');
  // code point 単位 (絵文字がサロゲート半欠けで表示されない — レビュー指摘)
  const cps = useMemo(() => lines.map((l) => Array.from(l)), [joined]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = cps.reduce((n, l) => n + l.length, 0);
  const [chars, setChars] = useState(reduced ? total : 0);
  const doneCharsRef = useRef(reduced ? total : 0);
  doneCharsRef.current = chars;
  useEffect(() => {
    setChars(reduced ? total : 0);
    if (reduced) return;
    // updater 内で clearInterval しない (updater は純粋であるべき — レビュー指摘)。
    // 打ち終わったら interval 自体を止める
    const id = setInterval(() => {
      if (doneCharsRef.current >= total) {
        clearInterval(id);
        return;
      }
      setChars((c) => Math.min(total, c + 1));
    }, 22);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lines は joined で代表する
  }, [joined, total, reduced]);
  let used = 0;
  return (
    // タップで残りを即時全文 (セリフウィンドウと同じ「タップ = スキップ」作法。
    // コマンドは非ブロックなので押し逃しの実害はないが、作法を統一する — レビュー指摘)
    <div onClick={() => setChars(total)}>
      {cps.map((cp, i) => {
        const visible = Math.max(0, Math.min(cp.length, chars - used));
        used += cp.length;
        return (
          <div key={i}>
            {/* SR には全文を渡し、タイプ途中表示は aria-hidden (汎用要素の
                aria-label は多くの SR が無視する — レビュー指摘) */}
            <span style={SR_ONLY}>{lines[i]}</span>
            <span aria-hidden>{cp.slice(0, visible).join('')}</span>
            {/* 高さを先に確保 (行が出るたびにコマンド段が下へずれるのを防ぐ) */}
            {visible === 0 && <span aria-hidden>&nbsp;</span>}
          </div>
        );
      })}
    </div>
  );
}

/** visually-hidden (スクリーンリーダーにだけ全文を渡す) */
const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
