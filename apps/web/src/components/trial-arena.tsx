import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from '@atproto/api';
import {
  BATTLE_TUNING,
  ITEMS,
  MONSTERS_BY_ID,
  jobDisplayName,
  levelUpGains,
  type StatGain,
  earnedTitles,
  pickTrialTier,
  resolveTurn,
  rollDrops,
  startBattle,
  statVectorToArray,
  type Archetype,
  type BattleState,
  type Command,
  type GearSelection,
  type StatVector,
  type TurnEvent,
} from '@aozoraquest/core';
import { BattleView } from './battle-view';
import { EncounterWipe, type WipePhase } from './encounter-wipe';
import { MonsterSvg } from './monster-svg';
import { SpiritBubble } from './spirit-bubble';
import type { PointsState } from '@/lib/points';
import { bumpPower } from '@/lib/points';
import {
  awardBattleXp,
  finishBattleRecord,
  loadBattleStats,
  startBattleRecord,
  type BattleLevelUps,
  type BattleStats,
} from '@/lib/battle-log';
import { formatGain, notifyLevelUp } from './level-up-overlay';
import { loadCraftInventory } from '@/lib/crafting';
import { loadGearRefs, resolveGear } from '@/lib/gear';

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
      /** XP 加算で確定したレベルアップ (非同期に届くので optional) */
      levelUps?: BattleLevelUps;
      /** レベルアップによるステータス上昇 (from 両軸 → to 両軸の合算、0.1 未満除外) */
      statGains?: StatGain[];
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
  rpgStats,
  jobXpOffset = 0,
  onXpAwarded,
  points,
  onPointsChanged,
}: {
  agent: Agent;
  did: string;
  archetype: Archetype;
  jobLevel: number;
  playerLevel: number;
  playerName: string;
  /** プロフィールの個人 5 パラメータ (戦闘値の基底)。未診断はジョブ基準にフォールバック */
  rpgStats?: StatVector | null;
  /** ジョブレベル表示に含まれるレコード外 XP (クエスト報酬 questXp)。レベルアップ
   *  判定を画面表示と一致させるために渡す */
  jobXpOffset?: number;
  /** XP 加算が確定したとき呼ばれる (親は analysis を再取得して表示レベルを更新する) */
  onXpAwarded?: () => void;
  points: PointsState;
  onPointsChanged: (next: PointsState) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'select' });
  const [stats, setStats] = useState<BattleStats | null>(null);
  const [gearSel, setGearSel] = useState<GearSelection>({});
  const gearReadyRef = useRef(false);
  const gearSelRef = useRef(gearSel);
  gearSelRef.current = gearSel;
  const [err, setErr] = useState<string | null>(null);
  /** エンカウント演出 (DQ1 風ワイプ。encounter-wipe.tsx)。cover → (hold) → reveal。 */
  const [wipe, setWipe] = useState<WipePhase | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const refreshStats = useCallback(() => {
    loadBattleStats(agent, did).then(setStats).catch(() => {});
    // 装備 (gear/self の rkey 参照を所持個体で解決 — docs/20 W6c)
    Promise.all([loadCraftInventory(agent, did), loadGearRefs(agent, did)])
      .then(([inv, refs]) => {
        setGearSel(resolveGear(refs, inv.pieces, archetype).selection);
        gearReadyRef.current = true;
      })
      .catch(() => {}); // 失敗時は begin 側の ensureGear が再試行する
  }, [agent, did, archetype]);

  /** 開戦前に装備を確実に解決する (ロード完了前の挑戦で「装備なしの有料戦闘」が
   *  確定する窓を塞ぐ — レビュー指摘)。ロード済みなら即返し、未了なら await。 */
  const ensureGear = useCallback(async (): Promise<GearSelection> => {
    if (gearReadyRef.current) return gearSelRef.current;
    try {
      const [inv, refs] = await Promise.all([loadCraftInventory(agent, did), loadGearRefs(agent, did)]);
      const sel = resolveGear(refs, inv.pieces, archetype).selection;
      setGearSel(sel);
      gearReadyRef.current = true;
      return sel;
    } catch (e) {
      console.warn('gear load failed (fighting bare)', e);
      return {};
    }
  }, [agent, did, archetype]);
  useEffect(() => { refreshStats(); }, [refreshStats]);

  const begin = useCallback(
    async (fixedTier?: 1 | 2 | 3) => {
      if (points.balance < BATTLE_TUNING.powerCost) return;
      setErr(null);
      // 32bit seed (Math.random で十分。決定性はエンジン側の性質)
      const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
      // 難易度は選ばせない: 初挑戦はやさしい敵、以降はレベルに応じて自動抽選。
      // (再戦 = fixedTier は同じ tier でもう一度)
      const tier = fixedTier ?? pickTrialTier(seed, playerLevel, stats?.total ?? 0);
      setPhase({ kind: 'starting', tier });
      setWipe('cover'); // ワイプで画面を覆いながら支払いを進める (遅い通信は hold でつなぐ)
      // やくそう / そらのしずくは在庫から上限まで持ち込む (使用分は battle レコードで差し引く)
      const herbs = Math.min(BATTLE_TUNING.herbCarryMax, stats?.materials['herb'] ?? 0);
      const tonics = Math.min(BATTLE_TUNING.tonicCarryMax, stats?.materials['sky-dew'] ?? 0);
      const gear = await ensureGear();
      const state = startBattle(archetype, jobLevel, playerLevel, playerName, tier, seed, herbs, undefined, {
        tonics,
        // プロフィールの個人パラメータを戦闘値の基底にする (オーナー指摘 2026-07-17)
        ...(rpgStats ? { baseStats: statVectorToArray(rpgStats) } : {}),
        gear,
      });
      try {
        // 支払い + 仮レコード (棄権 = 敗北)。ここが失敗したらバトルを始めない。
        const rkey = await startBattleRecord(agent, { seed, tier, monsterId: state.monsterId });
        void bumpPower(agent, did, { battles: 1 });
        onPointsChanged({ ...points, battles: points.battles + 1, balance: points.balance - BATTLE_TUNING.powerCost });
        // starting 中のときだけ battle へ (hold タイムアウトで select に戻した後に
        // 遅れて届いた成功が戦闘に飛び込まないように。その場合レコードは棄権扱い)
        setPhase((p) => (p.kind === 'starting' ? { kind: 'battle', state, tier, rkey, busy: false } : p));
        // 覆い切って待機中 (hold) なら開く。cover 中なら onCoverDone 側が拾う。
        setWipe((w) => (w === 'hold' ? 'reveal' : w));
      } catch (e) {
        console.warn('battle start failed', e);
        setErr('試練を始められなかった。通信を確認してもう一度どうぞ。');
        setPhase({ kind: 'select' });
        // select に向かって開き直す (CSS の都合で一瞬全面黒に跳んでから開く。許容)
        setWipe((w) => (w ? 'reveal' : w));
      }
    },
    [agent, did, archetype, jobLevel, playerLevel, playerName, rpgStats, points, onPointsChanged, stats, ensureGear],
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
      // 決着: レコード確定 + XP + ドロップ。逃走は無事に離脱しただけなので XP もドロップも無し。
      const drops = next.outcome === 'win' ? rollDrops(next.monsterId, next.player.luk, next.seed) : [];
      const xp = next.outcome === 'win' ? BATTLE_TUNING.xpWin : next.outcome === 'fled' ? 0 : BATTLE_TUNING.xpLose;
      const record = {
        seed: next.seed,
        tier: phase.tier,
        monsterId: next.monsterId,
        outcome: next.outcome,
        turns: next.turn,
        drops,
        herbsUsed: next.herbsUsed,
        tonicsUsed: next.tonicsUsed,
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
      if (xp > 0) {
        void awardBattleXp(agent, did, xp, { jobXpOffset }).then((ups) => {
          if (!ups) return;
          // 親に XP 反映を通知 (diag 再取得)。演出だけ出して表示レベルが古いままだと
          // 「LEVEL UP! と言われたのに次戦も LV5」の矛盾が見える (レビュー指摘)
          onXpAwarded?.();
          // ステータス上昇量 (オーナー要望 2026-07-17: 何がいくつ上がったかを出す)。
          // job → player の順に区間を分けて二重計上しない
          const base = rpgStats ? statVectorToArray(rpgStats) : undefined;
          const jFrom = ups.job?.from ?? jobLevel;
          const jTo = ups.job?.to ?? jobLevel;
          const pFrom = ups.player?.from ?? playerLevel;
          const pTo = ups.player?.to ?? playerLevel;
          // 全画面演出 (LevelUpOverlay は app 全体に常時マウント済み)。
          // 発火順は投稿フロー (compose-modal) と同じ job → player
          if (ups.job) {
            notifyLevelUp({
              kind: 'job',
              from: ups.job.from,
              to: ups.job.to,
              jobName: jobDisplayName(ups.job.archetype, 'default'),
              gains: levelUpGains(archetype, { jobLevel: jFrom, playerLevel: pFrom }, { jobLevel: jTo, playerLevel: pFrom }, base),
            });
          }
          if (ups.player) {
            notifyLevelUp({
              kind: 'player',
              from: ups.player.from,
              to: ups.player.to,
              gains: levelUpGains(archetype, { jobLevel: jTo, playerLevel: pFrom }, { jobLevel: jTo, playerLevel: pTo }, base),
            });
          }
          // リザルトの文言にも残す (演出は 2 秒で消えるため)。文言は両軸まとめた合算。
          // seed 照合で再戦後の別リザルトに前戦の分を付けない (world 側と同じ防御)
          const statGains = levelUpGains(archetype, { jobLevel: jFrom, playerLevel: pFrom }, { jobLevel: jTo, playerLevel: pTo }, base);
          setPhase((p) => (p.kind === 'result' && p.state.seed === next.seed ? { ...p, levelUps: ups, statGains } : p));
        });
      }
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
        for (const [item, used] of [
          ['herb', next.herbsUsed],
          ['sky-dew', next.tonicsUsed],
        ] as const) {
          if (used <= 0) continue;
          const left = Math.max(0, (materials[item] ?? 0) - used);
          if (left > 0) materials[item] = left;
          else delete materials[item];
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
    [phase, agent, did, stats, refreshStats, jobXpOffset, onXpAwarded, archetype, jobLevel, playerLevel, rpgStats],
  );

  // ワイプ進行: 覆い切った時点でバトル準備がまだなら hold でつなぐ
  const onCoverDone = useCallback(() => {
    setWipe(phaseRef.current.kind === 'battle' ? 'reveal' : 'hold');
  }, []);
  const onRevealDone = useCallback(() => setWipe(null), []);
  // hold の上限 (10s) 到達 = 支払い通信ハング。select に開き直す (全面黒ロック防止)
  const onHoldTimeout = useCallback(() => {
    setErr('試練を始められなかった (通信が不安定)。もう一度どうぞ。');
    setPhase((p) => (p.kind === 'starting' ? { kind: 'select' } : p));
    setWipe('reveal');
  }, []);
  const wipeOverlay = wipe ? (
    <EncounterWipe
      phase={wipe}
      holdMessage="ブルスコンが 呼び出している…"
      onCoverDone={onCoverDone}
      onRevealDone={onRevealDone}
      onHoldTimeout={onHoldTimeout}
    />
  ) : null;

  // ─── select ───
  // battle 準備完了でも cover/hold 中は select/starting 画面を描き続ける
  // (覆い切る前に下がバトル画面へ差し替わると演出が崩れる — encounter-wipe の契約。
  //  レビュー ★★★ 指摘: 支払いが cover より速いのが最頻パス)
  const coveringBattle = phase.kind === 'battle' && wipe !== null && wipe !== 'reveal';
  if (phase.kind === 'select' || phase.kind === 'starting' || coveringBattle) {
    const canPlay = points.balance >= BATTLE_TUNING.powerCost;
    const starting = phase.kind !== 'select';
    return (
      <div>
        <SpiritBubble>
          これからは会話のかわりに、試練できみの力を見せてもらうよ。わたしが呼んだ相手と、きみのジョブの力で戦うんだ。1 回につきあおぞらパワーを {BATTLE_TUNING.powerCost} つかう。
        </SpiritBubble>
        <div style={{ margin: '0.8em 0 0.4em', fontSize: '0.85em', color: 'var(--color-muted)' }}>
          あおぞらパワー: <strong style={{ color: 'var(--color-fg)' }}>{points.balance}</strong>
          (投稿すると増える)
        </div>
        <div style={{ marginTop: '0.6em', textAlign: 'center' }}>
          <button
            type="button"
            disabled={!canPlay || starting}
            onClick={() => void begin()}
            style={{
              padding: '0.9em 2em',
              fontSize: '1.05em',
              opacity: canPlay && !starting ? 1 : 0.55,
            }}
          >
            {starting ? '呼び出している…' : '試練に挑む'}
          </button>
          <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.4em' }}>
            {(stats?.total ?? 0) === 0
              ? 'はじめての試練は、やさしい相手を呼んでもらえる。'
              : '相手はブルスコンが選ぶ。強くなるほど手強いのが来る。'}
          </p>
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
        {wipeOverlay}
      </div>
    );
  }

  // ─── battle (表示は battle-view に共通化。world の野外遭遇と同じレンダラー) ───
  if (phase.kind === 'battle') {
    return (
      <div>
        <BattleView
          state={phase.state}
          busy={phase.busy}
          onCommand={(c) => void act(c)}
          headerNote={`${'★'.repeat(phase.tier)} ${TIER_LABELS[phase.tier].name}`}
        />
        {wipeOverlay}
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
        {won ? '勝利!' : state.outcome === 'lose' ? 'まけてしまった…' : state.outcome === 'fled' ? 'にげだした!' : 'ひきわけ'}
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
            : state.outcome === 'fled'
              ? '引きぎわを知るのも強さのうちさ。また挑んでおいで。'
              : 'いい勝負だった。次は決着をつけよう。'}
      </SpiritBubble>
      <div aria-live="polite" style={{ margin: '0.8em 0', fontSize: '0.9em', display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
        {xp > 0 && <div>経験値 +{xp}</div>}
        {phase.levelUps?.player && (
          <div style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
            レベルが {phase.levelUps.player.to} に あがった!
          </div>
        )}
        {phase.levelUps?.job && (
          <div style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
            {jobDisplayName(phase.levelUps.job.archetype, 'default')}のジョブレベルが {phase.levelUps.job.to} に あがった!
          </div>
        )}
        {phase.statGains && phase.statGains.length > 0 && (
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
            {phase.statGains.map((g) => `${g.label} +${formatGain(g.delta)}`).join('、')}
          </div>
        )}
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
      {wipeOverlay}
    </div>
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
