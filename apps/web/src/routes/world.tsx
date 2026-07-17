import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BattleState, Command, DiagnosisResult } from '@aozoraquest/core';
import {
  BATTLE_TUNING,
  ITEMS,
  MONSTERS_BY_ID,
  jobDisplayName,
  levelUpGains,
  type StatGain,
  encounterRateFor,
  isWalkable,
  jobLevelFromXp,
  playerCombatant,
  playerLevelFromXp,
  regionDanger,
  regionOf,
  resolveTurn,
  rollDrops,
  startBattle,
  statVectorToArray,
  terrainAt,
  tileDetailAt,
  townAt,
  worldOverlay,
  wrap,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import { loadWorldState, saveWorldState } from '@/lib/world-state';
import { awardBattleXp, finishBattleRecord, loadBattleStats, startBattleRecord, type BattleLevelUps } from '@/lib/battle-log';
import { formatGain, notifyLevelUp } from '@/components/level-up-overlay';
import { bumpPower, loadPointsState, type PointsState } from '@/lib/points';
import { WORLD_PREVIEW_ENABLED } from '@/lib/world-preview';
import { Avatar } from '@/components/avatar';
import { BattleView, HpBar, MpBar } from '@/components/battle-view';
import { EncounterWipe, type WipePhase } from '@/components/encounter-wipe';
import { MonsterSvg } from '@/components/monster-svg';
import { PLAINS_VARIANTS, TERRAIN_TILES } from '@/components/world-tiles';

/**
 * あおぞらワールド (docs/19-overworld.md) — 散歩 + 遭遇プレビュー。
 *
 * - 16×16 ビューポート、1 タップ 1 マス、トーラス wrap。
 * - **HP/MP は戦闘をまたいで持続** (オーナー決定)。街に立ち寄ると全回復 + その街が
 *   「最後に立ち寄った街」= 敗北時の帰還先になる。フィールドでどうぐを使える。
 * - 野外戦闘は試練と同じ機構で **1 戦 = パワー 1 消費 + 戦闘レコード + XP/素材の報酬**
 *   (パワー不足だと遭遇しない = 散歩だけならタダ)。遭遇判定自体はまだプレビュー
 *   (Math.random)。PR-W3 で移動ごと Worker (署名付き seed) に置換。dev 環境限定。
 */

const VIEW = 16;
const HALF = VIEW / 2;
const TILE = 32;

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Record<Dir, { dx: number; dy: number; glyph: string; label: string }> = {
  up: { dx: 0, dy: -1, glyph: '↑', label: '上に移動' },
  down: { dx: 0, dy: 1, glyph: '↓', label: '下に移動' },
  left: { dx: -1, dy: 0, glyph: '←', label: '左に移動' },
  right: { dx: 1, dy: 0, glyph: '→', label: '右に移動' },
};

const DANGER_LABELS = ['おだやか', 'すこし危険', '危険', 'とても危険'] as const;

interface Vitals {
  x: number;
  y: number;
  /** null = 全快 (最大値はジョブ/レベルから導出) */
  hp: number | null;
  mp: number | null;
  lastTown: { x: number; y: number } | null;
}

export function World() {
  const session = useSession();
  const agent = session.agent ?? null;
  const did = session.did ?? null;
  const [ws, setWs] = useState<Vitals | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [notice, setNotice] = useState<string | null>(null); // 進めない/回復などの一行メッセージ
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [diag, setDiag] = useState<DiagnosisResult | null>(null);
  /** やくそう/そらのしずくの手持ち。戦闘内の使用と獲得は battle レコードに残る。
   *  フィールドでの使用はセッション内のみ (TODO(W3): 在庫の正を Worker/DO に移す)。 */
  const [herbStock, setHerbStock] = useState(0);
  const [tonicStock, setTonicStock] = useState(0);
  const [points, setPoints] = useState<PointsState | null>(null);
  const [battle, setBattle] = useState<{ state: BattleState; busy: boolean; rkey: string; tier: 1 | 2 | 3 } | null>(null);
  /** エンカウント演出 (DQ1 風ワイプ)。cover 中はマップの上でタイルが閉じ、覆い切ったら
   *  バトル画面に差し替えて reveal で開く。支払い通信が長い場合は hold でつなぐ。 */
  const [wipe, setWipe] = useState<WipePhase | null>(null);
  const [battleResult, setBattleResult] = useState<{
    state: BattleState;
    movedToTown: string | null;
    drops: string[];
    xp: number;
    saveFailed: boolean;
    /** XP 加算で確定したレベルアップ (非同期に届く) */
    levelUps?: BattleLevelUps;
    /** レベルアップによるステータス上昇 (合算、0.1 未満除外) */
    statGains?: StatGain[];
  } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [tilePx, setTilePx] = useState(24);

  const archetype = diag?.archetype ?? null;
  // ジョブ/レベル由来の最大値 (フィールド HP/MP バーの分母)
  const combat = archetype
    ? playerCombatant(
        archetype,
        jobLevelFromXp(diag?.jobLevel?.xp ?? 0),
        playerLevelFromXp(diag?.playerLevel?.xp ?? 0),
        '',
        diag?.rpgStats ? statVectorToArray(diag.rpgStats) : undefined,
      )
    : null;
  const curHp = combat ? Math.min(ws?.hp ?? combat.maxHp, combat.maxHp) : null;
  const curMp = combat ? Math.min(ws?.mp ?? combat.maxMp, combat.maxMp) : null;

  // 初期ロード。位置の読み込み失敗はエラー表示 + リトライ (spawn に倒すと
  // 「テレポート → 上書き保存」のデータ損失になるため倒さない)。
  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !did) return;
    let cancelled = false;
    setLoadErr(false);
    (async () => {
      try {
        const state = await loadWorldState(agent, did);
        if (cancelled) return;
        setWs({ x: state.x, y: state.y, hp: state.hp, mp: state.mp, lastTown: state.lastTown });
      } catch (e) {
        console.warn('[world] load failed', e);
        if (!cancelled) setLoadErr(true);
        return;
      }
      const [profile, d, stats, pts] = await Promise.all([
        agent.getProfile({ actor: did }).catch(() => null),
        getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
        loadBattleStats(agent, did).catch(() => null),
        loadPointsState(agent, did).catch(() => null),
      ]);
      if (cancelled) return;
      setAvatarUrl(profile?.data.avatar ?? null);
      setDiag(d);
      setHerbStock(stats?.materials['herb'] ?? 0);
      setTonicStock(stats?.materials['sky-dew'] ?? 0);
      setPoints(pts);
    })();
    return () => { cancelled = true; };
  }, [session.status, agent, did, retryNonce]);

  // タイル実寸の追従 (アバターオーバーレイ用)
  useEffect(() => {
    const el = mapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setTilePx(el.clientWidth / VIEW);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ws === null, battle === null, battleResult === null]);

  // 状態保存 (2 秒デバウンス + unmount 時に確定)
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const scheduleSave = useCallback(() => {
    if (!agent) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const s = wsRef.current;
      if (s) void saveWorldState(agent, s);
    }, 2000);
  }, [agent]);
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      const s = wsRef.current;
      if (agent && s) void saveWorldState(agent, s);
    }
  }, [agent]);

  const battleRef = useRef(battle);
  battleRef.current = battle;
  const battleResultRef = useRef(battleResult);
  battleResultRef.current = battleResult;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const diagRef = useRef(diag);
  diagRef.current = diag;
  const wipeRef = useRef(wipe);
  wipeRef.current = wipe;

  const move = useCallback(
    (dir: Dir) => {
      const s = wsRef.current;
      // 戦闘中・リザルト表示中は移動不可 (リザルト中に矢印キーで見えない移動 +
      // 新遭遇がリザルトを上書きする事故を防ぐ。レビュー指摘)
      if (!s || battleRef.current || battleResultRef.current) return;
      const { dx, dy } = DIRS[dir];
      const nx = wrap(s.x + dx);
      const ny = wrap(s.y + dy);
      const terrain = terrainAt(nx, ny);
      if (!isWalkable(terrain)) {
        setNotice('そっちには進めない!');
        return; // 位置不変なので保存もしない
      }
      // 街に入ったら全回復 + 「最後に立ち寄った街」を更新 (敗北時の帰還先)
      if (terrain === 'town') {
        const t = townAt(nx, ny);
        setNotice(t ? `「${t.name}」で休んで、すっかり元気になった!` : null);
        // wsRef を即時更新 (長押し連打で render 前の tick が同座標から二重計算しないように)
        wsRef.current = { x: nx, y: ny, hp: null, mp: null, lastTown: { x: nx, y: ny } };
        setWs(wsRef.current);
        scheduleSave();
        return; // 街では遭遇しない
      }
      setNotice(null);
      wsRef.current = { ...s, x: nx, y: ny };
      setWs(wsRef.current);
      scheduleSave();
      // 野外遭遇 (遭遇判定はプレビュー: Math.random。PR-W3 で Worker の署名付き seed に)。
      // 1 戦 = パワー 1 消費 + 戦闘レコード (試練と同じ機構)。パワー不足なら遭遇しない
      // (= 散歩だけならタダ。無料戦闘で報酬だけ稼げる穴を作らない)。
      const d = diag;
      const pts = pointsRef.current;
      if (!agent || !did || !d || !pts || pts.balance < BATTLE_TUNING.powerCost) return;
      if (Math.random() < encounterRateFor(terrain)) {
        const danger = regionDanger(regionOf(nx, ny));
        const tier = (danger <= 1 ? 1 : danger === 2 ? 2 : 3) as 1 | 2 | 3;
        const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
        const jobLv = jobLevelFromXp(d.jobLevel?.xp ?? 0);
        const playerLv = playerLevelFromXp(d.playerLevel?.xp ?? 0);
        const herbs = Math.min(BATTLE_TUNING.herbCarryMax, herbStock);
        const tonics = Math.min(BATTLE_TUNING.tonicCarryMax, tonicStock);
        const cHp = wsRef.current?.hp;
        const cMp = wsRef.current?.mp;
        const state = startBattle(
          d.archetype,
          jobLv,
          playerLv,
          session.handle?.split('.')[0] ?? 'あなた',
          tier,
          seed,
          herbs,
          // フィールドの現在 HP/MP を引き継ぐ (戦闘をまたいで持続)
          { ...(cHp !== null && cHp !== undefined ? { hp: cHp } : {}), ...(cMp !== null && cMp !== undefined ? { mp: cMp } : {}) },
          { tonics, ...(d.rpgStats ? { baseStats: statVectorToArray(d.rpgStats) } : {}) },
        );
        // 遭遇成立: ワイプ演出でマップを覆いながら支払いを進める (busy = コマンド不可)。
        // battleRef は即時更新して長押し連打の次 tick が移動 + 二重遭遇しないようにする。
        const pending = { state, busy: true, rkey: '', tier };
        battleRef.current = pending;
        setBattle(pending);
        setWipe('cover');
        void (async () => {
          try {
            // 支払い + 仮レコード (途中離脱 = 棄権 = 敗北)。失敗したら遭遇なしに戻す。
            const rkey = await startBattleRecord(agent, { seed, tier, monsterId: state.monsterId });
            void bumpPower(agent, did, { battles: 1 });
            setPoints((p) => (p ? { ...p, battles: p.battles + 1, balance: p.balance - BATTLE_TUNING.powerCost } : p));
            setBattle((b) => {
              if (!(b && b.state.seed === seed)) return b;
              // battleRef も即時更新 (onCoverDone のタイマーが render flush 前に
              // 発火しても準備完了を読めるように。pending 生成時と同じ流儀)
              const ready = { ...b, rkey, busy: false };
              battleRef.current = ready;
              return ready;
            });
            // 覆い切って待機中 (hold) なら開く。cover 中なら onCoverDone 側が拾う。
            setWipe((w) => (w === 'hold' ? 'reveal' : w));
          } catch (e) {
            console.warn('[world] field battle start failed', e);
            setNotice('モンスターの気配がしたが、見失った… (通信エラー)');
            setBattle((b) => (b && b.state.seed === seed ? null : b));
            // マップに向かって開き直す (注: CSS の都合で「いったん全面黒に跳んでから
            // 開く」見え方になる。稀な経路なので許容 — レビュー確認済み)
            setWipe((w) => (w ? 'reveal' : w));
          }
        })();
      }
    },
    [scheduleSave, diag, session.handle, herbStock, tonicStock, agent, did],
  );

  // 戦闘コマンド (戦闘解決はクライアント。W3/W4 でサーバー権威に置換)
  const onBattleCommand = useCallback(
    async (command: Command) => {
      const b = battleRef.current;
      if (!b || b.busy || !agent || !did) return;
      const next = resolveTurn(b.state, command);
      // battleRef も同期更新 (同一フレームの二重発火が busy=false を二重観測して
      // レコード確定/XP が二重実行される穴を塞ぐ。move() と同じ流儀。レビュー指摘)
      const acting = { ...b, state: next, busy: true };
      battleRef.current = acting;
      setBattle(acting);
      await new Promise((r) => setTimeout(r, 450));
      if (next.outcome === 'ongoing') {
        setBattle((cur) => (cur ? { ...cur, state: next, busy: false } : cur));
        return;
      }
      // 決着: レコード確定 + XP + ドロップ (試練と同じ)。逃走は XP もドロップも無し。
      const drops = next.outcome === 'win' ? rollDrops(next.monsterId, next.player.luk, next.seed) : [];
      const xp = next.outcome === 'win' ? BATTLE_TUNING.xpWin : next.outcome === 'fled' ? 0 : BATTLE_TUNING.xpLose;
      const record = {
        seed: next.seed,
        tier: b.tier,
        monsterId: next.monsterId,
        outcome: next.outcome,
        turns: next.turn,
        drops,
        herbsUsed: next.herbsUsed,
        tonicsUsed: next.tonicsUsed,
      };
      // 保存は 1 回リトライ。失敗したらリザルトで明示 (仮レコードが敗北のまま残る)。
      let saveFailed = false;
      try {
        await finishBattleRecord(agent, b.rkey, record);
      } catch {
        try {
          await finishBattleRecord(agent, b.rkey, record);
        } catch (e) {
          console.warn('[world] battle finish record failed (after retry)', e);
          saveFailed = true;
        }
      }
      if (xp > 0) {
        void awardBattleXp(agent, did, xp).then((ups) => {
          if (!ups) return;
          // ステータス上昇量は再取得前の diag (レベルアップ前の基準) から計算する
          const d = diagRef.current;
          const base = d?.rpgStats ? statVectorToArray(d.rpgStats) : undefined;
          const arch = d?.archetype;
          const jNow = jobLevelFromXp(d?.jobLevel?.xp ?? 0);
          const pNow = playerLevelFromXp(d?.playerLevel?.xp ?? 0);
          const jFrom = ups.job?.from ?? jNow;
          const jTo = ups.job?.to ?? jNow;
          const pFrom = ups.player?.from ?? pNow;
          const pTo = ups.player?.to ?? pNow;
          // 表示レベル (HP/MP バー分母・次戦の戦闘値) を追従させる。演出だけ出して
          // maxHp が増えないと「LEVEL UP! なのに強くなってない」に見える (レビュー指摘)
          void getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self')
            .then((nd) => { if (nd) setDiag(nd); })
            .catch(() => {});
          // 発火順は投稿フロー (compose-modal) と同じ job → player
          if (ups.job) {
            notifyLevelUp({
              kind: 'job',
              from: ups.job.from,
              to: ups.job.to,
              jobName: jobDisplayName(ups.job.archetype, 'default'),
              ...(arch ? { gains: levelUpGains(arch, { jobLevel: jFrom, playerLevel: pFrom }, { jobLevel: jTo, playerLevel: pFrom }, base) } : {}),
            });
          }
          if (ups.player) {
            notifyLevelUp({
              kind: 'player',
              from: ups.player.from,
              to: ups.player.to,
              ...(arch ? { gains: levelUpGains(arch, { jobLevel: jTo, playerLevel: pFrom }, { jobLevel: jTo, playerLevel: pTo }, base) } : {}),
            });
          }
          // 同じ戦闘のリザルトが出ている間だけ文言も反映 (次の遭遇に紛れ込ませない)
          const statGains = arch
            ? levelUpGains(arch, { jobLevel: jFrom, playerLevel: pFrom }, { jobLevel: jTo, playerLevel: pTo }, base)
            : [];
          setBattleResult((r) => (r && r.state.seed === next.seed ? { ...r, levelUps: ups, statGains } : r));
        });
      }
      // 手持ちを更新: 使った分を引き、ドロップ分を足す。
      // TODO(W3): 在庫の正は Worker (DO) に移す (フィールド使用分が記録されない併走は
      // プレビュー限定の割り切り)。
      setHerbStock((n) => Math.max(0, n - next.herbsUsed) + drops.filter((x) => x === 'herb').length);
      setTonicStock((n) => Math.max(0, n - next.tonicsUsed) + drops.filter((x) => x === 'sky-dew').length);
      let movedToTown: string | null = null;
      if (next.outcome === 'lose') {
        // 敗北: 最後に立ち寄った街 (無ければはじまりの街) へ。宿で介抱 = 全快。
        // lastTown はワールド再生成で街が動くと無効になりうるので townAt で検証し、
        // 無効なら座標・名前とも spawn に倒す (レビュー指摘)。
        const s = wsRef.current;
        const spawn = worldOverlay().spawn;
        const lt = s?.lastTown;
        const valid = lt && townAt(lt.x, lt.y) ? lt : null;
        const back = valid ?? { x: spawn.x, y: spawn.y };
        movedToTown = townAt(back.x, back.y)?.name ?? spawn.name;
        setWs({ x: back.x, y: back.y, hp: null, mp: null, lastTown: valid });
      } else {
        // 勝利/引き分け/逃走: 減った HP/MP をフィールドに持ち帰る (持続)。
        // 満タンは null に正規化 (絶対値で焼くと後のレベルアップで「減って見える」)。
        const hp = next.player.hp >= next.player.maxHp ? null : Math.max(1, next.player.hp);
        const mp = next.player.mp >= next.player.maxMp ? null : next.player.mp;
        setWs((s) => (s ? { ...s, hp, mp } : s));
      }
      scheduleSave();
      setBattle(null);
      setBattleResult({ state: next, movedToTown, drops, xp, saveFailed });
    },
    [scheduleSave, agent, did],
  );

  // ワイプ演出の進行。覆い切った時点で支払いがまだ終わっていなければ hold でつなぐ
  // (通信の遅さが「固まった」に見えず、演出の一部になる)。
  const onCoverDone = useCallback(() => {
    const b = battleRef.current;
    setWipe(b && b.rkey === '' && b.busy ? 'hold' : 'reveal');
  }, []);
  const onRevealDone = useCallback(() => setWipe(null), []);
  // hold の上限 (10s) 到達 = 支払い通信ハング。遭遇をキャンセルしてマップに開き直す
  // (全面黒でリロード以外の脱出手段がなくなるのを防ぐ。レコードが後から成立していた
  // 場合は棄権 = 敗北の既存セマンティクスに落ちる)。
  const onHoldTimeout = useCallback(() => {
    setNotice('通信が不安定でモンスターを見失った…');
    setBattle((b) => (b && b.busy && b.rkey === '' ? null : b));
    setWipe('reveal');
  }, []);

  // フィールドでやくそうを使う (移動せずに回復。消費の保存は TODO(W3) で DO に)
  const useHerbOnField = useCallback(() => {
    if (!combat || herbStock <= 0) return;
    const cur = wsRef.current;
    if (!cur) return;
    const hpNow = Math.min(cur.hp ?? combat.maxHp, combat.maxHp);
    if (hpNow >= combat.maxHp) {
      setNotice('HP は満タンだ。');
      return;
    }
    const heal = Math.round(combat.maxHp * BATTLE_TUNING.herbHealRatio);
    const healed = Math.min(combat.maxHp, hpNow + heal);
    setHerbStock((n) => n - 1);
    setWs({ ...cur, hp: healed >= combat.maxHp ? null : healed });
    setNotice(`やくそうを使った! HP が ${healed - hpNow} 回復。`);
    scheduleSave();
  }, [combat, herbStock, scheduleSave]);

  // フィールドでそらのしずくを使う (MP 回復)
  const useTonicOnField = useCallback(() => {
    if (!combat || tonicStock <= 0) return;
    const cur = wsRef.current;
    if (!cur) return;
    const mpNow = Math.min(cur.mp ?? combat.maxMp, combat.maxMp);
    if (mpNow >= combat.maxMp) {
      setNotice('MP は満タンだ。');
      return;
    }
    const gain = Math.max(1, Math.round(combat.maxMp * BATTLE_TUNING.tonicMpRatio));
    const restored = Math.min(combat.maxMp, mpNow + gain);
    setTonicStock((n) => n - 1);
    setWs({ ...cur, mp: restored >= combat.maxMp ? null : restored });
    setNotice(`そらのしずくを使った! MP が ${restored - mpNow} 回復。`);
    scheduleSave();
  }, [combat, tonicStock, scheduleSave]);

  // 位置リセット (プレビュー用): はじまりの街へ戻る (全快)
  const resetToSpawn = useCallback(() => {
    const spawn = worldOverlay().spawn;
    setBattle(null);
    setBattleResult(null);
    setWipe(null);
    setNotice(null);
    setWs({ x: spawn.x, y: spawn.y, hp: null, mp: null, lastTown: { x: spawn.x, y: spawn.y } });
    scheduleSave();
  }, [scheduleSave]);

  // キーボード (PC)。修飾キー付き (Cmd+← のブラウザ戻る等) は奪わない。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // 演出 (wipe) 中もキーボード移動を止める (ポインタは overlay が吸うが
      // キーボードは素通りするため。レビュー指摘)
      if (!wsRef.current || battleRef.current || wipeRef.current) return;
      const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const dir = map[e.key];
      if (dir) {
        e.preventDefault();
        move(dir);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);

  if (!WORLD_PREVIEW_ENABLED) {
    return (
      <div>
        <h2>あおぞらワールド</h2>
        <p style={{ color: 'var(--color-muted)' }}>じゅんびちゅう… もうすこし待っててね。</p>
        <Link to="/spirit">← ブルスコンのところへ戻る</Link>
      </div>
    );
  }
  if (session.status === 'loading') return <p>読み込み中…</p>;
  if (session.status === 'signed-out') {
    return (
      <div>
        <h2>あおぞらワールド</h2>
        <p>ログインすると世界を歩けます。</p>
        <Link to="/onboarding"><button>ログイン</button></Link>
      </div>
    );
  }
  if (loadErr) {
    return (
      <div>
        <h2>あおぞらワールド</h2>
        <p style={{ color: 'var(--color-danger)' }}>現在地を読み込めなかった。通信を確認してもう一度どうぞ。</p>
        <button type="button" onClick={() => setRetryNonce((n) => n + 1)}>再読み込み</button>
      </div>
    );
  }
  if (!ws) return <p>世界を読み込んでいる…</p>;

  // エンカウント演出のオーバーレイ (cover/hold 中はマップの上、reveal 中はバトル画面の上)
  const wipeOverlay = wipe ? (
    <EncounterWipe
      phase={wipe}
      holdMessage="モンスターが あらわれようとしている…"
      onCoverDone={onCoverDone}
      onRevealDone={onRevealDone}
      onHoldTimeout={onHoldTimeout}
    />
  ) : null;

  // ─── 野外遭遇 (戦闘中はマップの代わりにバトル画面)。cover/hold 中はまだマップを
  //     見せたままタイルで覆っていく (覆い切った瞬間にこちらへ切り替わる) ───
  if (battle && (wipe === null || wipe === 'reveal')) {
    const danger = regionDanger(regionOf(ws.x, ws.y));
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* 途中離脱 = 敗北の開示はヘッダ側 (低い端末ではコマンド下が fold 落ちする。レビュー指摘) */}
        <h2 style={{ margin: '0 0 0.1em' }}>たたかい! <span style={{ fontSize: '0.6em', color: 'var(--color-muted)' }}>(パワー {BATTLE_TUNING.powerCost} 消費)</span></h2>
        <p style={{ margin: '0 0 0.2em', fontSize: '0.7em', color: 'var(--color-muted)' }}>
          ※ とちゅうでやめる (画面を閉じる) と敗北あつかいになるよ。
        </p>
        <BattleView
          state={battle.state}
          busy={battle.busy}
          onCommand={(c) => void onBattleCommand(c)}
          headerNote={DANGER_LABELS[danger]}
        />
        {wipeOverlay}
      </div>
    );
  }
  if (battleResult) {
    const { state, movedToTown, drops, xp, saveFailed } = battleResult;
    const won = state.outcome === 'win';
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ opacity: won ? 0.45 : 1, display: 'inline-block', transform: won ? 'rotate(180deg)' : 'none' }}>
          <MonsterSvg species={MONSTERS_BY_ID[state.monsterId]?.species ?? 'slime'} size={110} />
        </div>
        <h3 style={{ margin: '0.4em 0' }}>
          {won ? '勝利!' : state.outcome === 'lose' ? 'まけてしまった…' : state.outcome === 'fled' ? 'にげだした!' : 'ひきわけ'}
        </h3>
        {state.lastEvents.length > 0 && (
          <div style={{ margin: '0.5em auto', maxWidth: 420, fontSize: '0.8em', lineHeight: 1.6, textAlign: 'left', padding: '0.4em 0.7em', border: '2px solid var(--color-border)', borderRadius: 4, background: 'var(--color-window-bg)' }}>
            {state.lastEvents.map((e, i) => <div key={i}>{e.text}</div>)}
          </div>
        )}
        <div aria-live="polite" style={{ margin: '0.6em 0', fontSize: '0.9em', display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
          {xp > 0 && <div>経験値 +{xp}</div>}
          {battleResult.levelUps?.player && (
            <div style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
              レベルが {battleResult.levelUps.player.to} に あがった!
            </div>
          )}
          {battleResult.levelUps?.job && (
            <div style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
              {jobDisplayName(battleResult.levelUps.job.archetype, 'default')}のジョブレベルが {battleResult.levelUps.job.to} に あがった!
            </div>
          )}
          {battleResult.statGains && battleResult.statGains.length > 0 && (
            <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
              {battleResult.statGains.map((g) => `${g.label} +${formatGain(g.delta)}`).join('、')}
            </div>
          )}
          {drops.length > 0 && (
            <div>素材を手に入れた: {drops.map((d) => ITEMS[d]?.name ?? d).join('、')}</div>
          )}
          {saveFailed && (
            <div style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>
              ※ 結果の保存に失敗した (通信エラー)。この 1 戦は記録上「敗北」のまま残ることがある。
            </div>
          )}
        </div>
        {state.outcome === 'fled' && (
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
            なにも手に入らなかったが、ぶじに逃げのびた。(つかったパワーは戻らない)
          </p>
        )}
        {movedToTown && (
          <p style={{ fontSize: '0.85em' }}>気がつくと「{movedToTown}」で介抱されていた… (全回復)</p>
        )}
        <button type="button" onClick={() => setBattleResult(null)} style={{ padding: '0.7em 1.6em' }}>
          マップへ戻る
        </button>
        {/* reveal 中に決着した場合でも演出を最後まで流す (無いと wipe='reveal' が
            残留してマップ復帰時に再生される。レビュー指摘) */}
        {wipeOverlay}
      </div>
    );
  }

  const town = townAt(ws.x, ws.y);
  const here = terrainAt(ws.x, ws.y);
  const danger = regionDanger(regionOf(ws.x, ws.y));

  // ビューポートのタイル列 (プレイヤー中央固定)。平地は見た目バリアントを散らす。
  const tiles = [];
  for (let vy = 0; vy < VIEW; vy++) {
    for (let vx = 0; vx < VIEW; vx++) {
      const x = wrap(ws.x - HALF + vx);
      const y = wrap(ws.y - HALF + vy);
      const t = terrainAt(x, y);
      const body = t === 'plains' ? PLAINS_VARIANTS[tileDetailAt(x, y)] : TERRAIN_TILES[t];
      tiles.push(
        <g key={`${vx}-${vy}`} transform={`translate(${vx * TILE},${vy * TILE})`}>
          {body}
        </g>,
      );
    }
  }

  const avatarSize = Math.max(16, Math.round(tilePx * 1.15));

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.3em' }}>
        <h2 style={{ margin: 0 }}>あおぞらワールド <span style={{ fontSize: '0.6em', color: 'var(--color-muted)' }}>(散歩プレビュー)</span></h2>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)', fontFamily: 'ui-monospace, monospace' }}>
          ({ws.x}, {ws.y})
        </span>
      </div>
      {/* 場所情報 (街名 / 危険度)。一時メッセージ (notice) はここではなく
          操作ボタンの直下に出す — アイテムボタンは画面下部にあるのに結果表示が
          マップ上部だと視界に入らない (オーナー報告 2026-07-17、スクリーンショット付き) */}
      <p style={{ margin: '0.2em 0 0.4em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
        {town ? (
          <strong style={{ color: 'var(--color-fg)' }}>🏘 {town.name}</strong>
        ) : (
          <>このあたり: {DANGER_LABELS[danger]}{here === 'forest' ? ' / 深い森…' : ''}</>
        )}
      </p>

      {/* フィールドの HP/MP (戦闘をまたいで持続) */}
      {combat && curHp !== null && curMp !== null && (
        <div style={{ marginBottom: '0.5em' }}>
          <HpBar name={session.handle?.split('.')[0] ?? 'あなた'} hp={curHp} maxHp={combat.maxHp} mine />
          <MpBar mp={curMp} maxMp={combat.maxMp} />
        </div>
      )}

      {/* マップ本体。アバターは SVG 外の HTML オーバーレイ (装備が枠外に出るため)。 */}
      <div className="dq-window" style={{ padding: 4 }}>
        <div ref={mapRef} style={{ position: 'relative' }}>
          <svg
            viewBox={`0 0 ${VIEW * TILE} ${VIEW * TILE}`}
            style={{ display: 'block', width: '100%' }}
            aria-label="ワールドマップ"
          >
            {tiles}
            <ellipse
              cx={HALF * TILE + TILE / 2}
              cy={HALF * TILE + TILE * 0.8}
              rx={TILE * 0.34}
              ry={TILE * 0.14}
              fill="rgba(0,0,0,0.3)"
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              left: `${((HALF + 0.5) / VIEW) * 100}%`,
              top: `${((HALF + 0.5) / VIEW) * 100}%`,
              transform: 'translate(-50%, -55%)',
              width: avatarSize,
              height: avatarSize,
              pointerEvents: 'none',
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
            }}
          >
            <Avatar src={avatarUrl ?? undefined} size={avatarSize} archetype={archetype} />
          </div>
        </div>
      </div>

      {/* 十字キー (親指ゾーン) + どうぐ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gap: 6, justifyContent: 'center', marginTop: '0.8em' }}>
        <span />
        <DirButton dir="up" onMove={move} />
        <span />
        <DirButton dir="left" onMove={move} />
        <DirButton dir="down" onMove={move} />
        <DirButton dir="right" onMove={move} />
      </div>
      <div style={{ textAlign: 'center', marginTop: '0.5em', display: 'flex', gap: '0.5em', justifyContent: 'center', flexWrap: 'wrap' }}>
        {/* 満タン時は disabled にせず押下時 notice で理由を言う
            (disabled だと「在庫があるのに押せない理由」が読めない。レビュー指摘) */}
        <button
          type="button"
          onClick={useHerbOnField}
          disabled={herbStock <= 0 || !combat}
          style={{ fontSize: '0.85em', padding: '0.5em 1.2em', touchAction: 'manipulation' }}
        >
          やくそう ×{herbStock} <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>HP回復</span>
        </button>
        <button
          type="button"
          onClick={useTonicOnField}
          disabled={tonicStock <= 0 || !combat}
          style={{ fontSize: '0.85em', padding: '0.5em 1.2em', touchAction: 'manipulation' }}
        >
          そらのしずく ×{tonicStock} <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>MP回復</span>
        </button>
      </div>
      {/* 一時メッセージ (やくそう使用 / 進めない / 街で回復 など)。操作した指の
          すぐ近くに出す。minHeight 常設で出現時のレイアウトシフトを防ぐ */}
      <p
        aria-live="polite"
        style={{ textAlign: 'center', fontSize: '0.85em', minHeight: '1.4em', margin: '0.5em 0 0' }}
      >
        {notice && <strong style={{ color: 'var(--color-fg)' }}>{notice}</strong>}
      </p>
      <p style={{ textAlign: 'center', fontSize: '0.72em', color: 'var(--color-muted)', marginTop: '0.4em' }}>
        PC は矢印キーでも移動できます。街に入ると全回復。
        {diag
          ? points === null
            ? ' パワー残高を読み込めなかった (通信エラー)。モンスターは出ません。再読み込みでもう一度どうぞ。'
            : points.balance >= BATTLE_TUNING.powerCost
              ? ` 歩くとモンスターが出ることがあります (1 戦 = あおぞらパワー ${BATTLE_TUNING.powerCost}、勝つと経験値と素材)。いまのパワー: ${points.balance}`
              : ' あおぞらパワーがないのでモンスターは出ません (投稿すると増える)。'
          : ''}
      </p>
      <p style={{ textAlign: 'center', marginTop: '0.4em' }}>
        <button
          type="button"
          className="secondary"
          onClick={resetToSpawn}
          style={{ fontSize: '0.8em', padding: '0.4em 1em' }}
        >
          はじまりの街へ戻る (位置リセット)
        </button>
      </p>
      {wipeOverlay}
    </div>
  );
}

/** 長押しの連続移動: 最初の一歩の後、この間隔 (ms) で歩き続ける。 */
const HOLD_REPEAT_DELAY = 350;
const HOLD_REPEAT_INTERVAL = 170;

function DirButton({ dir, onMove }: { dir: Dir; onMove: (d: Dir) => void }) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const movedByHold = useRef(false);

  const stopHold = useCallback(() => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (repeatTimer.current) { clearInterval(repeatTimer.current); repeatTimer.current = null; }
  }, []);
  useEffect(() => stopHold, [stopHold]);

  // pointerdown で 1 歩 + 長押しで連続移動 (クリック二重発火を防ぐため click は使わない)。
  const startHold = useCallback(() => {
    movedByHold.current = true;
    onMove(dir);
    holdTimer.current = setTimeout(() => {
      repeatTimer.current = setInterval(() => onMove(dir), HOLD_REPEAT_INTERVAL);
    }, HOLD_REPEAT_DELAY);
  }, [dir, onMove]);

  return (
    <button
      type="button"
      aria-label={DIRS[dir].label}
      onPointerDown={(e) => {
        e.preventDefault(); // 長押しの文字選択・拡大鏡を抑止 (iOS)
        startHold();
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onContextMenu={(e) => e.preventDefault()} // 長押しメニュー抑止
      // キーボード操作 (Enter/Space) は click で 1 歩 (pointerdown 経由は movedByHold)
      onClick={() => {
        if (movedByHold.current) { movedByHold.current = false; return; }
        onMove(dir);
      }}
      style={{
        height: 56,
        fontSize: '1.4em',
        padding: 0,
        // 連打でダブルタップズームを誘発しない (iOS)
        touchAction: 'manipulation',
        // 長押しで矢印グリフが文字選択されるのを防ぐ (オーナー報告)
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      } as React.CSSProperties}
    >
      {DIRS[dir].glyph}
    </button>
  );
}
