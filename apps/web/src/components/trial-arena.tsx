import { useCallback, useEffect, useState } from 'react';
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
 * (途中離脱 = 棄権 = 敗北。負けそうで閉じる、を無料にしない。select 画面で開示)。
 */

type Phase =
  | { kind: 'select' }
  | { kind: 'starting'; tier: 1 | 2 | 3 }
  | { kind: 'battle'; state: BattleState; tier: 1 | 2 | 3; rkey: string; busy: boolean }
  | {
      kind: 'result';
      state: BattleState;
      tier: 1 | 2 | 3;
      drops: string[];
      xp: number;
      newTitles: string[];
      finalEvents: TurnEvent[];
      saveFailed: boolean;
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

  const refreshStats = useCallback(() => {
    loadBattleStats(agent, did).then(setStats).catch(() => {});
  }, [agent, did]);
  useEffect(() => { refreshStats(); }, [refreshStats]);

  const begin = useCallback(
    async (tier: 1 | 2 | 3) => {
      if (points.balance < BATTLE_TUNING.powerCost) return;
      setErr(null);
      setPhase({ kind: 'starting', tier });
      // 32bit seed (Math.random で十分。決定性はエンジン側の性質)
      const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
      // やくそうは在庫から最大 herbCarryMax 個持ち込む (使用分は battle レコードで差し引く)
      const herbs = Math.min(BATTLE_TUNING.herbCarryMax, stats?.materials['herb'] ?? 0);
      const state = startBattle(archetype, jobLevel, playerLevel, playerName, tier, seed, herbs);
      try {
        // 支払い + 仮レコード (棄権 = 敗北)。ここが失敗したらバトルを始めない。
        const rkey = await startBattleRecord(agent, { seed, tier, monsterId: state.monsterId });
        void bumpPower(agent, did, { battles: 1 });
        onPointsChanged({ ...points, battles: points.battles + 1, balance: points.balance - BATTLE_TUNING.powerCost });
        setPhase({ kind: 'battle', state, tier, rkey, busy: false });
      } catch (e) {
        console.warn('battle start failed', e);
        setErr('試練を始められなかった。通信を確認してもう一度どうぞ。');
        setPhase({ kind: 'select' });
      }
    },
    [agent, did, archetype, jobLevel, playerLevel, playerName, points, onPointsChanged, stats],
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
      const record = {
        seed: next.seed,
        tier: phase.tier,
        monsterId: next.monsterId,
        outcome: next.outcome,
        turns: next.turn,
        drops,
        herbsUsed: next.herbsUsed,
      };
      // 保存は 1 回リトライ。最終的に失敗したらリザルトで明示する
      // (仮レコードが敗北のままだと、勝ちと素材が記録に残らないため)。
      let saveFailed = false;
      try {
        await finishBattleRecord(agent, phase.rkey, record);
      } catch {
        try {
          await finishBattleRecord(agent, phase.rkey, record);
        } catch (e) {
          console.warn('battle finish record failed (after retry)', e);
          saveFailed = true;
        }
      }
      void awardBattleXp(agent, did, xp);
      // 称号の新規獲得判定 (確定前の stats と比較)。stats 未取得 (取得失敗) 時は
      // 称号トーストを出さないだけで戦績自体はレコードに残る。
      const before = stats ? earnedTitles(stats).map((t) => t.id) : [];
      const after = stats
        ? earnedTitles({
            wins: stats.wins + (next.outcome === 'win' ? 1 : 0),
            losses: stats.losses + (next.outcome === 'lose' ? 1 : 0),
            bestStreak: Math.max(stats.bestStreak, next.outcome === 'win' ? stats.currentStreak + 1 : 0),
            tier3Wins: stats.tier3Wins + (next.outcome === 'win' && phase.tier === 3 ? 1 : 0),
          })
        : [];
      const newTitles = after.filter((t) => !before.includes(t.id)).map((t) => t.name);
      // stats を楽観更新する。refreshStats (listRecords 数往復) の完了を待たずに
      // 「もういちど挑む」を押しても、やくそうの持ち込みが古い在庫で二重にならない
      // (在庫超過は集計側で 0 止めされ、以後のドロップが黙って相殺される事故になる)。
      setStats((s) => {
        if (!s) return s;
        const materials = { ...s.materials };
        for (const d of drops) materials[d] = (materials[d] ?? 0) + 1;
        if (next.herbsUsed > 0) {
          const left = Math.max(0, (materials['herb'] ?? 0) - next.herbsUsed);
          if (left > 0) materials['herb'] = left;
          else delete materials['herb'];
        }
        const win = next.outcome === 'win';
        const currentStreak = win ? s.currentStreak + 1 : 0;
        return {
          ...s,
          total: s.total + 1,
          wins: s.wins + (win ? 1 : 0),
          losses: s.losses + (next.outcome === 'lose' ? 1 : 0),
          tier3Wins: s.tier3Wins + (win && phase.tier === 3 ? 1 : 0),
          currentStreak,
          bestStreak: Math.max(s.bestStreak, currentStreak),
          materials,
        };
      });
      setPhase({
        kind: 'result',
        state: next,
        tier: phase.tier,
        drops,
        xp,
        newTitles,
        finalEvents: next.lastEvents,
        saveFailed,
      });
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
          これからは会話のかわりに、試練できみの力を見せてもらうよ。わたしが呼んだ相手と、きみのジョブの力で戦うんだ。1 回につきあおぞらパワーを {BATTLE_TUNING.powerCost} つかう。
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
                opacity: canPlay && !starting ? 1 : 0.55,
              }}
            >
              <span>
                {starting && phase.tier === tier ? '呼び出している…' : `${'★'.repeat(tier)} ${TIER_LABELS[tier].name}`}
              </span>
              <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{TIER_LABELS[tier].hint}</span>
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.5em' }}>
          ※ 試練の途中でやめる (画面を閉じる) と敗北あつかいになるよ。
        </p>
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
        {/* 敵エリア。key=turn で再マウントして被弾シェイクを毎ターン再生する
            (class 文字列が同じままだと CSS アニメは再始動しない)。 */}
        <div style={{ textAlign: 'center', paddingTop: '0.4em' }}>
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

        {/* コマンド (親指ゾーン、2x2)。特技は MP、やくそうは残数で使用可否が決まる。 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5em', marginTop: '0.8em' }}>
          <CommandButton label="たたかう" sub={`MP +${BATTLE_TUNING.mpAttackGain}`} onClick={() => void act('attack')} disabled={phase.busy} />
          <CommandButton
            label={state.playerSkill.name}
            sub={`MP ${BATTLE_TUNING.skillMpCost} / ${SKILL_KIND_LABELS[state.playerSkill.kind].split(' ')[0]}`}
            onClick={() => void act('skill')}
            disabled={phase.busy || state.player.mp < BATTLE_TUNING.skillMpCost}
          />
          <CommandButton
            label="ぼうぎょ"
            sub={`回避↑ / MP +${BATTLE_TUNING.mpGuardGain}`}
            onClick={() => void act('guard')}
            disabled={phase.busy}
          />
          <CommandButton
            label={`やくそう ×${state.herbs}`}
            sub={`HP ${Math.round(BATTLE_TUNING.herbHealRatio * 100)}% 回復`}
            onClick={() => void act('herb')}
            disabled={phase.busy || state.herbs <= 0 || state.player.hp >= state.player.maxHp}
          />
        </div>
      </div>
    );
  }

  // ─── result ───
  const { state, tier, drops, xp, newTitles, finalEvents, saveFailed } = phase;
  const won = state.outcome === 'win';
  return (
    <div style={{ textAlign: 'center' }}>
      {/* 倒されたモンスター (= 勝利時) を逆さ + 薄表示にする。敗北時は健在のまま。 */}
      <div style={{ opacity: won ? 0.45 : 1, display: 'inline-block', transform: won ? 'rotate(180deg)' : 'none' }}>
        <MonsterSvg species={MONSTERS_BY_ID[state.monsterId]?.species ?? 'slime'} size={120} />
      </div>
      <h3 style={{ margin: '0.4em 0' }}>
        {won ? '勝利!' : state.outcome === 'lose' ? 'まけてしまった…' : 'ひきわけ'}
      </h3>
      {/* 決着ターンのログ (「たおした!」や 30 ターン判定の口上) はここで読めるようにする */}
      {finalEvents.length > 0 && (
        <div
          style={{
            margin: '0.5em auto',
            maxWidth: 420,
            padding: '0.4em 0.7em',
            border: '2px solid var(--color-border)',
            borderRadius: 4,
            background: 'var(--color-window-bg)',
            fontSize: '0.8em',
            lineHeight: 1.6,
            textAlign: 'left',
          }}
        >
          {finalEvents.map((e, i) => (
            <div key={i}>{e.text}</div>
          ))}
        </div>
      )}
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
        {saveFailed && (
          <div style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>
            ※ 結果の保存に失敗した (通信エラー)。この 1 戦は記録上「敗北」のまま残ることがある。
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.6em', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={points.balance < BATTLE_TUNING.powerCost}
          onClick={() => void begin(tier)}
          style={{ padding: '0.7em 1.4em' }}
        >
          もういちど挑む (パワー {points.balance})
        </button>
        <button type="button" onClick={() => setPhase({ kind: 'select' })} style={{ padding: '0.7em 1.4em' }}>
          試練の間に戻る
        </button>
      </div>
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

function MpBar({ mp, maxMp }: { mp: number; maxMp: number }) {
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
