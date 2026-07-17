import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BattleState, Command, DiagnosisResult } from '@aozoraquest/core';
import {
  BATTLE_TUNING,
  MONSTERS_BY_ID,
  encounterRateFor,
  isWalkable,
  jobLevelFromXp,
  playerCombatant,
  playerLevelFromXp,
  regionDanger,
  regionOf,
  resolveTurn,
  startBattle,
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
import { loadBattleStats } from '@/lib/battle-log';
import { WORLD_PREVIEW_ENABLED } from '@/lib/world-preview';
import { Avatar } from '@/components/avatar';
import { BattleView, HpBar, MpBar } from '@/components/battle-view';
import { MonsterSvg } from '@/components/monster-svg';
import { PLAINS_VARIANTS, TERRAIN_TILES } from '@/components/world-tiles';

/**
 * あおぞらワールド (docs/19-overworld.md) — 散歩 + 遭遇プレビュー。
 *
 * - 16×16 ビューポート、1 タップ 1 マス、トーラス wrap。
 * - **HP/MP は戦闘をまたいで持続** (オーナー決定)。街に立ち寄ると全回復 + その街が
 *   「最後に立ち寄った街」= 敗北時の帰還先になる。フィールドでやくそうを使える。
 * - 遭遇はプレビュー (Math.random / 消費・報酬・記録なし)。本実装は PR-W3 で
 *   Worker (署名付き seed + パワー消費) に置換。dev 環境限定 (world-preview.ts)。
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
  /** やくそうの手持ち (セッション内。プレビューなので消費は保存しない) */
  const [herbStock, setHerbStock] = useState(0);
  const [battle, setBattle] = useState<{ state: BattleState; busy: boolean } | null>(null);
  const [battleResult, setBattleResult] = useState<{ state: BattleState; movedToTown: string | null } | null>(null);
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
      const [profile, d, stats] = await Promise.all([
        agent.getProfile({ actor: did }).catch(() => null),
        getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
        loadBattleStats(agent, did).catch(() => null),
      ]);
      if (cancelled) return;
      setAvatarUrl(profile?.data.avatar ?? null);
      setDiag(d);
      setHerbStock(stats?.materials['herb'] ?? 0);
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

  const move = useCallback(
    (dir: Dir) => {
      const s = wsRef.current;
      if (!s || battleRef.current) return; // 戦闘中は移動不可
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
        setWs({ x: nx, y: ny, hp: null, mp: null, lastTown: { x: nx, y: ny } });
        scheduleSave();
        return; // 街では遭遇しない
      }
      setNotice(null);
      setWs({ ...s, x: nx, y: ny });
      scheduleSave();
      // 野外遭遇 (プレビュー: Math.random。本実装は PR-W3 で Worker の署名付き seed に)
      const d = diag;
      if (d && Math.random() < encounterRateFor(terrain)) {
        const danger = regionDanger(regionOf(nx, ny));
        const tier = (danger <= 1 ? 1 : danger === 2 ? 2 : 3) as 1 | 2 | 3;
        const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
        const jobLv = jobLevelFromXp(d.jobLevel?.xp ?? 0);
        const playerLv = playerLevelFromXp(d.playerLevel?.xp ?? 0);
        const herbs = Math.min(BATTLE_TUNING.herbCarryMax, herbStock);
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
        );
        setBattle({ state, busy: false });
      }
    },
    [scheduleSave, diag, session.handle, herbStock],
  );

  // 戦闘コマンド (プレビュー: クライアント解決。W3/W4 でサーバー権威に置換)
  const onBattleCommand = useCallback(
    async (command: Command) => {
      const b = battleRef.current;
      if (!b || b.busy) return;
      const next = resolveTurn(b.state, command);
      setBattle({ state: next, busy: true });
      await new Promise((r) => setTimeout(r, 450));
      if (next.outcome === 'ongoing') {
        setBattle((cur) => (cur ? { state: next, busy: false } : cur));
        return;
      }
      // 決着。プレビューでは報酬・記録なし。やくそうはセッション内で減らす。
      setHerbStock((n) => Math.max(0, n - next.herbsUsed));
      let movedToTown: string | null = null;
      if (next.outcome === 'lose') {
        // 敗北: 最後に立ち寄った街 (無ければはじまりの街) へ。宿で介抱 = 全快。
        const s = wsRef.current;
        const back = s?.lastTown ?? { x: worldOverlay().spawn.x, y: worldOverlay().spawn.y };
        const t = townAt(back.x, back.y);
        movedToTown = t?.name ?? 'はじまりの街';
        setWs({ x: back.x, y: back.y, hp: null, mp: null, lastTown: s?.lastTown ?? null });
      } else {
        // 勝利/引き分け: 減った HP/MP をフィールドに持ち帰る (持続)
        setWs((s) => (s ? { ...s, hp: Math.max(1, next.player.hp), mp: next.player.mp } : s));
      }
      scheduleSave();
      setBattle(null);
      setBattleResult({ state: next, movedToTown });
    },
    [scheduleSave],
  );

  // フィールドでやくそうを使う (移動せずに回復。プレビュー: 消費は保存しない)
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

  // 位置リセット (プレビュー用): はじまりの街へ戻る (全快)
  const resetToSpawn = useCallback(() => {
    const spawn = worldOverlay().spawn;
    setBattle(null);
    setBattleResult(null);
    setNotice(null);
    setWs({ x: spawn.x, y: spawn.y, hp: null, mp: null, lastTown: { x: spawn.x, y: spawn.y } });
    scheduleSave();
  }, [scheduleSave]);

  // キーボード (PC)。修飾キー付き (Cmd+← のブラウザ戻る等) は奪わない。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!wsRef.current || battleRef.current) return;
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

  // ─── 野外遭遇 (戦闘中はマップの代わりにバトル画面) ───
  if (battle) {
    const danger = regionDanger(regionOf(ws.x, ws.y));
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 0.3em' }}>たたかい! <span style={{ fontSize: '0.6em', color: 'var(--color-muted)' }}>(プレビュー: 報酬・記録なし)</span></h2>
        <BattleView
          state={battle.state}
          busy={battle.busy}
          onCommand={(c) => void onBattleCommand(c)}
          headerNote={DANGER_LABELS[danger]}
        />
      </div>
    );
  }
  if (battleResult) {
    const { state, movedToTown } = battleResult;
    const won = state.outcome === 'win';
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ opacity: won ? 0.45 : 1, display: 'inline-block', transform: won ? 'rotate(180deg)' : 'none' }}>
          <MonsterSvg species={MONSTERS_BY_ID[state.monsterId]?.species ?? 'slime'} size={110} />
        </div>
        <h3 style={{ margin: '0.4em 0' }}>
          {won ? '勝利!' : state.outcome === 'lose' ? 'まけてしまった…' : 'ひきわけ'}
        </h3>
        {state.lastEvents.length > 0 && (
          <div style={{ margin: '0.5em auto', maxWidth: 420, fontSize: '0.8em', lineHeight: 1.6, textAlign: 'left', padding: '0.4em 0.7em', border: '2px solid var(--color-border)', borderRadius: 4, background: 'var(--color-window-bg)' }}>
            {state.lastEvents.map((e, i) => <div key={i}>{e.text}</div>)}
          </div>
        )}
        {movedToTown && (
          <p style={{ fontSize: '0.85em' }}>気がつくと「{movedToTown}」で介抱されていた… (全回復)</p>
        )}
        <p style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>※ プレビュー中の戦闘に報酬・記録・パワー消費はありません</p>
        <button type="button" onClick={() => setBattleResult(null)} style={{ padding: '0.7em 1.6em' }}>
          マップへ戻る
        </button>
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
      <p style={{ margin: '0.2em 0 0.4em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
        {notice ? (
          <strong style={{ color: 'var(--color-fg)' }}>{notice}</strong>
        ) : town ? (
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
      <div style={{ textAlign: 'center', marginTop: '0.5em' }}>
        <button
          type="button"
          onClick={useHerbOnField}
          disabled={herbStock <= 0 || !combat || (curHp !== null && combat !== null && curHp >= combat.maxHp)}
          style={{ fontSize: '0.85em', padding: '0.5em 1.2em', touchAction: 'manipulation' }}
        >
          やくそうを使う ×{herbStock}
        </button>
      </div>
      <p style={{ textAlign: 'center', fontSize: '0.72em', color: 'var(--color-muted)', marginTop: '0.4em' }}>
        PC は矢印キーでも移動できます。街に入ると全回復。
        {diag ? ' 歩くとモンスターが出ることがあります (プレビュー: 報酬・記録なし)。' : ''}
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
