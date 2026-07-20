import { useMemo, useState } from 'react';
import {
  ARCHETYPES,
  BATTLE_TUNING,
  EQUIPMENT,
  JOB_XP_CURVE,
  MONSTERS,
  MONSTERS_BY_ID,
  autoBattleCommand,
  battleXpFor,
  jobDisplayName,
  resolveTurn,
  runAutoBattle,
  startBattle,
  type Archetype,
  type BattleState,
  type Command,
  type GearSelection,
} from '@aozoraquest/core';

/**
 * 管理者デバッグ模擬戦シミュレータ (issue #414)。/spirit の管理者セクションから使う。
 *
 * 敵をリスト選択、プレイヤー側もジョブ/装備/レベルを選択し、
 *  - バッチ: N 戦 (seed 0..N-1) を自動プレイ → 勝率・平均 XP・平均ターン・生存時残 HP・次 Lv まで何戦。
 *    catch 率 (fleer の討伐率) もここに出る (逃走 = 非 win)。統計はこちらで見る。
 *  - 1 戦: 敵ステータスは variance 0 で固定しつつ、**戦闘中の乱数は毎ターン揺らす** (seed = 時刻)
 *    ことで本番同様に fleer 等が毎回変わる。自分でコマンドを選び挙動確認 (#441 で固定 seed を廃止)。
 * を行う。固定強度化 (#409) の上でエリア/順路/XP カーブ (#412/#413) の数値を詰める道具。
 */

const WORLD_HERB_MAX = 3;
const WORLD_TONIC_MAX = 3;

/** number 入力の NaN/範囲外を潰す (空欄 = NaN が startBattle に渡ると勝率 0% のゴミ結果になる)。 */
const clampInt = (v: number, def: number, min: number, max: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : def;

/** 1戦モードのコマンド表示名 (world 戦闘と同じ日本語で手触りを揃える)。 */
const CMD_LABEL: Record<Command, string> = {
  attack: 'たたかう', guard: 'ぼうぎょ', skill: 'とくぎ', herb: 'やくそう', tonic: 'しずく', flee: 'にげる',
};

/** その職の JobLv L→L+1 に必要な XP 差 (JOB_XP_CURVE の閾値差)。 */
function jobLevelGap(level: number): number {
  const cur = JOB_XP_CURVE.find((e) => e[0] === level)?.[1] ?? 0;
  const next = JOB_XP_CURVE.find((e) => e[0] === level + 1)?.[1];
  return next === undefined ? 0 : next - cur;
}

const bySlot = (slot: 'weapon' | 'armor' | 'charm') => EQUIPMENT.filter((e) => e.slot === slot);

interface BatchResult {
  trials: number;
  plLv: number;
  jobLv: number;
  winRate: number;
  avgXpPerWin: number;
  avgXpPerFight: number;
  avgTurns: number;
  avgHpPctOnWin: number;
  fightsToNextJobLv: number | null;
}

export function DebugBattleSim() {
  const [enemyId, setEnemyId] = useState(MONSTERS[0]!.id);
  const [job, setJob] = useState<Archetype>('warrior');
  const [playerLv, setPlayerLv] = useState(1);
  const [jobLv, setJobLv] = useState(1);
  const [weapon, setWeapon] = useState('');
  const [armor, setArmor] = useState('');
  const [charm, setCharm] = useState('');
  const [herbs, setHerbs] = useState(WORLD_HERB_MAX);
  const [tonics, setTonics] = useState(WORLD_TONIC_MAX);
  const [trials, setTrials] = useState(300);
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [duel, setDuel] = useState<BattleState | null>(null);

  const enemy = MONSTERS_BY_ID[enemyId]!;
  const gear = useMemo<GearSelection>(
    () => ({ ...(weapon ? { weapon } : {}), ...(armor ? { armor } : {}), ...(charm ? { charm } : {}) }),
    [weapon, armor, charm],
  );

  /** 1 戦を開始 (variance を指定)。tier は敵に付随 (monsterId 固定なので抽選はされない)。
   *  入力は clampInt で NaN/範囲外を潰してから渡す。 */
  const start = (seed: number, variance: number): BattleState =>
    startBattle(
      job,
      clampInt(jobLv, 1, 1, 50),
      clampInt(playerLv, 1, 1, 99),
      'sim',
      enemy.tier,
      seed,
      clampInt(herbs, 0, 0, WORLD_HERB_MAX),
      undefined,
      { monsterId: enemyId, gear, tonics: clampInt(tonics, 0, 0, WORLD_TONIC_MAX), vitalsVariance: variance },
    );

  const runBatch = () => {
    setDuel(null);
    const n = Math.max(1, Math.min(2000, Math.floor(trials)));
    let wins = 0;
    let xpSum = 0;
    let turnSum = 0;
    let hpPctSum = 0;
    for (let seed = 0; seed < n; seed++) {
      const end = runAutoBattle(start(seed, BATTLE_TUNING.monsterVitalsVariance)); // world と同じ分散
      turnSum += end.turn;
      if (end.outcome === 'win') {
        wins++;
        xpSum += battleXpFor(end.monsterId);
        hpPctSum += end.player.hp / end.player.maxHp;
      }
    }
    const avgXpPerFight = xpSum / n;
    const jl = clampInt(jobLv, 1, 1, 50);
    const gap = jobLevelGap(jl);
    setBatch({
      trials: n,
      plLv: clampInt(playerLv, 1, 1, 99),
      jobLv: jl,
      winRate: wins / n,
      avgXpPerWin: wins ? xpSum / wins : 0,
      avgXpPerFight,
      avgTurns: turnSum / n,
      avgHpPctOnWin: wins ? hpPctSum / wins : 0,
      fightsToNextJobLv: gap > 0 && avgXpPerFight > 0 ? Math.ceil(gap / avgXpPerFight) : null,
    });
  };

  // 固定 seed だと fleer が毎ターン同じ判定 = 100%逃走に見える乖離があった (#441)。1戦モードは
  // 「毎ターン判定が揺れる」だけでよく、本番 (edge) のような先読み防止 CSPRNG は不要 — seed を
  // 時刻にするだけで十分 (オーナー指摘)。手動/自動1手はクリック駆動なので ms 衝突しない。
  // 敵の初期ステータスは variance 0 で固定 (再現性)、戦闘中の乱数だけ毎ターン揺らす。
  const freshSeed = () => Date.now();
  const startDuel = () => {
    setBatch(null);
    // 初期 seed は固定でよい: monsterId 固定 + variance 0 なので敵ステータスは seed 非依存で一定
    // (summonMonster を通らず monsterCombatant の jitter も効かない)。戦闘中の乱数だけ下で新鮮に。
    setDuel(start(1, 0));
  };
  const duelCmd = (cmd: Command, skillIndex = 0) =>
    setDuel((s) => (s && s.outcome === 'ongoing' ? resolveTurn(s, cmd, freshSeed(), skillIndex) : s));
  const duelAuto = () =>
    setDuel((s) => (s && s.outcome === 'ongoing' ? resolveTurn(s, autoBattleCommand(s), freshSeed()) : s));

  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>模擬戦</h3>
      <p style={{ fontSize: '0.78em', color: 'var(--color-muted)', marginBottom: '0.5em' }}>
        敵・ジョブ・装備・レベルを選んでバランスを数値で確認する。バッチは多数試行の統計 (catch 率も)、
        1 戦は本番同様の乱数で自分で操作。
      </p>

      {/* 入力フォーム */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4em 0.6em', fontSize: '0.82em' }}>
        <label>敵
          <select value={enemyId} onChange={(e) => setEnemyId(e.target.value)} style={{ width: '100%' }}>
            {MONSTERS.map((m) => (
              <option key={m.id} value={m.id}>{`T${m.tier} ${m.name}`}</option>
            ))}
          </select>
        </label>
        <label>ジョブ
          <select value={job} onChange={(e) => setJob(e.target.value as Archetype)} style={{ width: '100%' }}>
            {ARCHETYPES.map((a) => (
              <option key={a} value={a}>{jobDisplayName(a)}</option>
            ))}
          </select>
        </label>
        <label>プレイヤーLv
          <input type="number" min={1} max={99} value={playerLv} onChange={(e) => setPlayerLv(Number(e.target.value))} style={{ width: '100%' }} />
        </label>
        <label>ジョブLv
          <input type="number" min={1} max={50} value={jobLv} onChange={(e) => setJobLv(Number(e.target.value))} style={{ width: '100%' }} />
        </label>
        <label>武器
          <select value={weapon} onChange={(e) => setWeapon(e.target.value)} style={{ width: '100%' }}>
            <option value="">(なし)</option>
            {bySlot('weapon').map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
          </select>
        </label>
        <label>防具
          <select value={armor} onChange={(e) => setArmor(e.target.value)} style={{ width: '100%' }}>
            <option value="">(なし)</option>
            {bySlot('armor').map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
          </select>
        </label>
        <label>お守り
          <select value={charm} onChange={(e) => setCharm(e.target.value)} style={{ width: '100%' }}>
            <option value="">(なし)</option>
            {bySlot('charm').map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
          </select>
        </label>
        <label>やくそう / しずく
          <span style={{ display: 'inline-flex', gap: '0.3em' }}>
            <input type="number" min={0} max={WORLD_HERB_MAX} value={herbs} onChange={(e) => setHerbs(Number(e.target.value))} style={{ width: '3em' }} />
            <input type="number" min={0} max={WORLD_TONIC_MAX} value={tonics} onChange={(e) => setTonics(Number(e.target.value))} style={{ width: '3em' }} />
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', marginTop: '0.6em', flexWrap: 'wrap' }}>
        <button onClick={runBatch}>バッチ</button>
        <label style={{ fontSize: '0.8em' }}>N
          <input type="number" min={1} max={2000} value={trials} onChange={(e) => setTrials(Number(e.target.value))} style={{ width: '4em', marginLeft: '0.3em' }} />
        </label>
        <button onClick={startDuel}>1戦プレイ</button>
      </div>

      {/* バッチ結果 */}
      {batch && (
        <div className="dq-window" style={{ marginTop: '0.6em', fontSize: '0.82em', padding: '0.6em 0.8em' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.3em' }}>{`${jobDisplayName(job)} (plLv${batch.plLv}/jobLv${batch.jobLv}) vs ${enemy.name} — ${batch.trials} 戦`}</div>
          <div>勝率 <b>{pct(batch.winRate)}</b> / 平均 {batch.avgTurns.toFixed(1)} ターン</div>
          <div>勝利時 残 HP <b>{pct(batch.avgHpPctOnWin)}</b></div>
          <div>XP: 勝利 {batch.avgXpPerWin.toFixed(1)} / 1 戦平均 {batch.avgXpPerFight.toFixed(2)}</div>
          <div>
            次 JobLv{batch.jobLv + 1} まで{' '}
            <b>{batch.fightsToNextJobLv === null ? '—' : `約 ${batch.fightsToNextJobLv} 戦`}</b>
            <span style={{ color: 'var(--color-muted)' }}>{' '}(勝利 XP は JobLv/PlayerLv に加算。敗北の xpLose は不算入の楽観値)</span>
          </div>
        </div>
      )}

      {/* 1 戦プレイ (本番同様の per-turn 乱数) */}
      {duel && (
        <div className="dq-window" style={{ marginTop: '0.6em', fontSize: '0.82em', padding: '0.6em 0.8em' }}>
          <div style={{ fontWeight: 700 }}>{`${jobDisplayName(job)} vs ${duel.monster.name}`}</div>
          <div>じぶん HP {duel.player.hp}/{duel.player.maxHp} · MP {duel.player.mp}/{duel.player.maxMp} · やくそう{duel.herbs} しずく{duel.tonics}</div>
          <div>てき HP {duel.monster.hp}/{duel.monster.maxHp}{duel.monster.charging ? ' · ⚡ため中' : ''}</div>
          <div style={{ margin: '0.3em 0', minHeight: '2.4em', color: 'var(--color-muted)' }}>
            {duel.lastEvents.map((ev, i) => (<div key={i}>{ev.text}</div>))}
          </div>
          {duel.outcome === 'ongoing' ? (
            <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap' }}>
              <button onClick={() => duelCmd('attack')} style={{ fontSize: '0.85em', padding: '0.2em 0.5em' }}>{CMD_LABEL.attack}</button>
              <button onClick={() => duelCmd('guard')} style={{ fontSize: '0.85em', padding: '0.2em 0.5em' }}>{CMD_LABEL.guard}</button>
              {/* とくぎは習得済みぶんを 1 個ずつボタン化 (#436 の複数とくぎを模擬戦で選べるように)。
                  複数無いジョブは署名 1 個だけ出る。MP 不足 / heal 満タンは disabled。 */}
              {(duel.playerSkills ?? [duel.playerSkill]).map((sk, i) => (
                <button
                  key={i}
                  onClick={() => duelCmd('skill', i)}
                  disabled={duel.player.mp < BATTLE_TUNING.skillMpCost || (sk.kind === 'heal' && duel.player.hp >= duel.player.maxHp)}
                  style={{ fontSize: '0.85em', padding: '0.2em 0.5em' }}
                >
                  {sk.name}
                </button>
              ))}
              {(['herb', 'tonic', 'flee'] as const).map((c) => (
                <button key={c} onClick={() => duelCmd(c)} style={{ fontSize: '0.85em', padding: '0.2em 0.5em' }}>{CMD_LABEL[c]}</button>
              ))}
              <button onClick={duelAuto} style={{ fontSize: '0.85em', padding: '0.2em 0.5em' }}>自動1手</button>
            </div>
          ) : (
            <div style={{ fontWeight: 700, color: 'var(--color-accent)' }}>決着: {duel.outcome} ({duel.turn} ターン)</div>
          )}
        </div>
      )}
    </section>
  );
}
