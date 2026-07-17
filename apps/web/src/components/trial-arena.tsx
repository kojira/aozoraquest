import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from '@atproto/api';
import {
  BATTLE_TUNING,
  ITEMS,
  MONSTERS_BY_ID,
  SKILL_KIND_LABELS,
  earnedTitles,
  resolveTurn,
  rollDrops,
  startBattle,
  type Archetype,
  type BattleState,
  type Command,
  type TurnEvent,
} from '@aozoraquest/core';
import { MonsterSvg } from './monster-svg';
import { SpiritBubble } from './spirit-bubble';
import type { PointsState } from '@/lib/points';
import { bumpPower } from '@/lib/points';
import {
  awardBattleXp,
  finishBattleRecord,
  loadBattleStats,
  startBattleRecord,
  type BattleStats,
} from '@/lib/battle-log';

/**
 * ブルスコンの試練 — アリーナ UI (docs/18-brusukon-trial.md)。
 *
 * スマホ縦画面前提: モンスターを大きく上に、コマンド 3 つを親指の届く下に。
 * 挑戦開始で 1 パワー消費 + 仮レコード (敗北扱い) を書き、決着時に確定へ更新する
 * (途中離脱 = 棄権 = 敗北。負けそうで閉じる、を無料にしない)。
 */

type Phase =
  | { kind: 'select' }
  | { kind: 'starting' }
  | { kind: 'battle'; state: BattleState; rkey: string; busy: boolean }
  | {
      kind: 'result';
      state: BattleState;
      drops: string[];
      xp: number;
      newTitles: string[];
    };

const TIER_LABELS: Record<1 | 2 | 3, { name: string; hint: string }> = {
  1: { name: '手習いの試練', hint: 'はじめての人向け' },
  2: { name: '修練の試練', hint: '腕試しに' },
  3: { name: '真剣勝負', hint: '強敵。心して' },
};

export function TrialArena({
  agent,
  did,
  archetype,
  jobLevel,
  playerLevel,
  playerName,
  points,
  onPointsChanged,
}: {
  agent: Agent;
  did: string;
  archetype: Archetype;
  jobLevel: number;
  playerLevel: number;
  playerName: string;
  points: PointsState;
  onPointsChanged: (next: PointsState) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'select' });
  const [stats, setStats] = useState<BattleStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refreshStats = useCallback(() => {
    loadBattleStats(agent, did).then(setStats).catch(() => {});
  }, [agent, did]);
  useEffect(() => { refreshStats(); }, [refreshStats]);

  // ログ末尾へオートスクロール
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  });

  const begin = useCallback(
    async (tier: 1 | 2 | 3) => {
      if (points.balance < BATTLE_TUNING.powerCost) return;
      setErr(null);
      setPhase({ kind: 'starting' });
      // 32bit seed (Math.random で十分。決定性はエンジン側の性質)
      const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
      const state = startBattle(archetype, jobLevel, playerLevel, playerName, tier, seed);
      try {
        // 支払い + 仮レコード (棄権 = 敗北)。ここが失敗したらバトルを始めない。
        const rkey = await startBattleRecord(agent, { seed, tier, monsterId: state.monsterId });
        void bumpPower(agent, did, { battles: 1 });
        onPointsChanged({ ...points, battles: points.battles + 1, balance: points.balance - BATTLE_TUNING.powerCost });
        setPhase({ kind: 'battle', state, rkey, busy: false });
      } catch (e) {
        console.warn('battle start failed', e);
        setErr('試練を始められなかった。通信を確認してもう一度どうぞ。');
        setPhase({ kind: 'select' });
      }
    },
    [agent, did, archetype, jobLevel, playerLevel, playerName, points, onPointsChanged],
  );

  const act = useCallback(
    async (command: Command) => {
      if (phase.kind !== 'battle' || phase.busy) return;
      const next = resolveTurn(phase.state, command);
      setPhase({ ...phase, state: next, busy: true });
      // 少し間を置いてから次コマンドを受け付ける (連打で読めないのを防ぐ)
      await new Promise((r) => setTimeout(r, 450));
      if (next.outcome === 'ongoing') {
        setPhase((p) => (p.kind === 'battle' ? { ...p, state: next, busy: false } : p));
        return;
      }
      // 決着: レコード確定 + XP + ドロップ
      const drops = next.outcome === 'win' ? rollDrops(next.monsterId, next.player.luk, next.seed) : [];
      const xp = next.outcome === 'win' ? BATTLE_TUNING.xpWin : BATTLE_TUNING.xpLose;
      try {
        await finishBattleRecord(agent, phase.rkey, {
          seed: next.seed,
          tier: MONSTERS_BY_ID[next.monsterId]?.tier ?? 1,
          monsterId: next.monsterId,
          outcome: next.outcome,
          turns: next.turn,
          drops,
        });
      } catch (e) {
        console.warn('battle finish record failed', e);
      }
      void awardBattleXp(agent, did, xp);
      // 称号の新規獲得判定 (確定前の stats と比較)
      const before = stats ? earnedTitles(stats).map((t) => t.id) : [];
      const after = stats
        ? earnedTitles({
            wins: stats.wins + (next.outcome === 'win' ? 1 : 0),
            losses: stats.losses + (next.outcome === 'lose' ? 1 : 0),
            bestStreak: Math.max(stats.bestStreak, next.outcome === 'win' ? stats.currentStreak + 1 : 0),
            tier3Wins: stats.tier3Wins + (next.outcome === 'win' && MONSTERS_BY_ID[next.monsterId]?.tier === 3 ? 1 : 0),
          })
        : [];
      const newTitles = after.filter((t) => !before.includes(t.id)).map((t) => t.name);
      setPhase({ kind: 'result', state: next, drops, xp, newTitles });
      refreshStats();
    },
    [phase, agent, did, stats, refreshStats],
  );

  // ─── select ───
  if (phase.kind === 'select' || phase.kind === 'starting') {
    const canPlay = points.balance >= BATTLE_TUNING.powerCost;
    const starting = phase.kind === 'starting';
    return (
      <div>
        <SpiritBubble>
          試練を受けるかい? わたしが呼んだ相手と、きみのジョブの力で戦うんだ。1 回につきあおぞらパワーを {BATTLE_TUNING.powerCost} つかうよ。
        </SpiritBubble>
        <div style={{ margin: '0.8em 0 0.4em', fontSize: '0.85em', color: 'var(--color-muted)' }}>
          あおぞらパワー: <strong style={{ color: 'var(--color-fg)' }}>{points.balance}</strong>
          (投稿すると増える)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6em', marginTop: '0.6em' }}>
          {([1, 2, 3] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              disabled={!canPlay || starting}
              onClick={() => void begin(tier)}
              style={{
                padding: '0.9em 1em',
                fontSize: '1em',
                textAlign: 'left',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                opacity: canPlay ? 1 : 0.55,
              }}
            >
              <span>{'★'.repeat(tier)} {TIER_LABELS[tier].name}</span>
              <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{TIER_LABELS[tier].hint}</span>
            </button>
          ))}
        </div>
        {!canPlay && (
          <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginTop: '0.5em' }}>
            パワーが足りない。あおぞらくえすとから投稿すると 1 つ増えるよ。
          </p>
        )}
        {err && <p style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>{err}</p>}
        {stats && stats.total > 0 && <RecordPanel stats={stats} />}
      </div>
    );
  }

  // ─── battle ───
  if (phase.kind === 'battle') {
    const { state } = phase;
    const monsterDef = MONSTERS_BY_ID[state.monsterId];
    return (
      <div>
        {/* 敵エリア */}
        <div style={{ textAlign: 'center', paddingTop: '0.4em' }}>
          <div style={{ display: 'inline-block' }} className={state.lastEvents.some((e) => e.actor === 'player' && e.damage) ? 'trial-hit' : ''}>
            <MonsterSvg species={monsterDef?.species ?? 'slime'} size={150} />
          </div>
          <HpBar name={state.monster.name} hp={state.monster.hp} maxHp={state.monster.maxHp} />
        </div>

        {/* ログ */}
        <div
          ref={logRef}
          style={{
            margin: '0.7em 0',
            padding: '0.5em 0.7em',
            border: '2px solid var(--color-border)',
            borderRadius: 4,
            background: 'var(--color-window-bg)',
            height: '7.5em',
            overflowY: 'auto',
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

        {/* 自分 HP */}
        <HpBar name={state.player.name} hp={state.player.hp} maxHp={state.player.maxHp} mine />

        {/* コマンド (親指ゾーン) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5em', marginTop: '0.8em' }}>
          <CommandButton label="たたかう" onClick={() => void act('attack')} disabled={phase.busy} />
          <CommandButton label="ぼうぎょ" onClick={() => void act('guard')} disabled={phase.busy} />
          <CommandButton
            label={state.playerSkill.name}
            sub={SKILL_KIND_LABELS[state.playerSkill.kind].split(' ')[0]}
            onClick={() => void act('skill')}
            disabled={phase.busy}
          />
        </div>
      </div>
    );
  }

  // ─── result ───
  const { state, drops, xp, newTitles } = phase;
  const won = state.outcome === 'win';
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ opacity: won ? 1 : 0.45, display: 'inline-block', transform: won ? 'none' : 'rotate(180deg)' }}>
        <MonsterSvg species={MONSTERS_BY_ID[state.monsterId]?.species ?? 'slime'} size={120} />
      </div>
      <h3 style={{ margin: '0.4em 0' }}>
        {won ? '勝利!' : state.outcome === 'lose' ? 'まけてしまった…' : 'ひきわけ'}
      </h3>
      <SpiritBubble>
        {won
          ? 'みごとだ! きみのジョブの力、しかと見せてもらったよ。'
          : state.outcome === 'lose'
            ? 'おしかったね。投稿を重ねて、また挑むといい。'
            : 'いい勝負だった。次は決着をつけよう。'}
      </SpiritBubble>
      <div style={{ margin: '0.8em 0', fontSize: '0.9em', display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
        <div>経験値 +{xp}</div>
        {drops.length > 0 && (
          <div>
            素材を手に入れた: {drops.map((d) => ITEMS[d]?.name ?? d).join('、')}
          </div>
        )}
        {newTitles.map((t) => (
          <div key={t} style={{ color: 'var(--color-accent)', fontWeight: 700 }}>称号「{t}」を獲得!</div>
        ))}
      </div>
      <button type="button" onClick={() => setPhase({ kind: 'select' })} style={{ padding: '0.7em 1.6em' }}>
        試練の間に戻る
      </button>
    </div>
  );
}

function HpBar({ name, hp, maxHp, mine = false }: { name: string; hp: number; maxHp: number; mine?: boolean }) {
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

function CommandButton({ label, sub, onClick, disabled }: { label: string; sub?: string | undefined; onClick: () => void; disabled: boolean }) {
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
      }}
    >
      <span>{label}</span>
      {sub && <span style={{ fontSize: '0.68em', color: 'var(--color-muted)' }}>{sub}</span>}
    </button>
  );
}

function RecordPanel({ stats }: { stats: BattleStats }) {
  const titles = earnedTitles(stats);
  const materialEntries = Object.entries(stats.materials);
  return (
    <section style={{ marginTop: '1.2em', fontSize: '0.85em' }}>
      <h3 style={{ fontSize: '1em', margin: '0 0 0.4em' }}>これまでの戦績</h3>
      <div style={{ display: 'flex', gap: '1.2em', flexWrap: 'wrap' }}>
        <span>{stats.wins} 勝 {stats.losses} 敗</span>
        <span>連勝中: {stats.currentStreak}</span>
        <span>最高連勝: {stats.bestStreak}</span>
      </div>
      {titles.length > 0 && (
        <div style={{ marginTop: '0.4em' }}>
          称号: {titles.map((t) => t.name).join(' / ')}
        </div>
      )}
      {materialEntries.length > 0 && (
        <div style={{ marginTop: '0.4em', color: 'var(--color-muted)' }}>
          素材: {materialEntries.map(([id, n]) => `${ITEMS[id]?.name ?? id}×${n}`).join('、')}
        </div>
      )}
    </section>
  );
}
