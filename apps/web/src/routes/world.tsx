import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BattleState, Command, DiagnosisResult } from '@aozoraquest/core';
import {
  MONSTERS_BY_ID,
  encounterRateFor,
  isWalkable,
  jobLevelFromXp,
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
import { WORLD_PREVIEW_ENABLED } from '@/lib/world-preview';
import { Avatar } from '@/components/avatar';
import { BattleView } from '@/components/battle-view';
import { MonsterSvg } from '@/components/monster-svg';
import { PLAINS_VARIANTS, TERRAIN_TILES } from '@/components/world-tiles';

/**
 * あおぞらワールド (docs/19-overworld.md) — PR-W2: 散歩プレビュー。
 *
 * 16×16 ビューポートでプレイヤー中央固定、1 タップ 1 マス移動。トーラス wrap。
 * この段階では**パワー消費なし・遭遇なし** (消費と判定は PR-W3 で Worker に移る)。
 * 位置は PDS (world/self) に保存 (デバウンス)。dev 環境限定 (world-preview.ts)。
 *
 * プレイヤーのアバターは SVG の foreignObject ではなく **HTML オーバーレイ**で描く
 * (foreignObject は overflow:hidden でジョブ装備が切れる + iOS Safari の位置ズレ quirk)。
 */

const VIEW = 16; // ビューポートの一辺 (タイル数)
const HALF = VIEW / 2;
const TILE = 32; // SVG 内の 1 タイルサイズ (表示は width 100% で縮尺)

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Record<Dir, { dx: number; dy: number; glyph: string; label: string }> = {
  up: { dx: 0, dy: -1, glyph: '↑', label: '上に移動' },
  down: { dx: 0, dy: 1, glyph: '↓', label: '下に移動' },
  left: { dx: -1, dy: 0, glyph: '←', label: '左に移動' },
  right: { dx: 1, dy: 0, glyph: '→', label: '右に移動' },
};

const DANGER_LABELS = ['おだやか', 'すこし危険', '危険', 'とても危険'] as const;

export function World() {
  const session = useSession();
  const agent = session.agent ?? null;
  const did = session.did ?? null;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [diag, setDiag] = useState<DiagnosisResult | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 野外遭遇 (プレビュー: 消費・報酬・記録なし)。battle=戦闘中 / result=決着直後
  const [battle, setBattle] = useState<{ state: BattleState; busy: boolean } | null>(null);
  const [battleResult, setBattleResult] = useState<{ state: BattleState; movedToTown: string | null } | null>(null);
  const archetype = diag?.archetype ?? null;
  // タイルの実表示サイズ (px)。アバターオーバーレイの寸法に使う。
  const mapRef = useRef<HTMLDivElement>(null);
  const [tilePx, setTilePx] = useState(24);

  // 初期ロード: 位置 + アバター + ジョブ。位置の読み込み失敗はエラー表示 + リトライ
  // (spawn に倒すと「テレポート → 上書き保存」のデータ損失になるため倒さない)。
  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !did) return;
    let cancelled = false;
    setLoadErr(false);
    (async () => {
      try {
        const state = await loadWorldState(agent, did);
        if (cancelled) return;
        setPos({ x: state.x, y: state.y });
      } catch (e) {
        console.warn('[world] load failed', e);
        if (!cancelled) setLoadErr(true);
        return;
      }
      const [profile, diag] = await Promise.all([
        agent.getProfile({ actor: did }).catch(() => null),
        getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
      ]);
      if (cancelled) return;
      setAvatarUrl(profile?.data.avatar ?? null);
      setDiag(diag);
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
  }, [pos === null]);

  // 位置保存 (2 秒デバウンス + unmount 時に確定)
  const posRef = useRef(pos);
  posRef.current = pos;
  const scheduleSave = useCallback(() => {
    if (!agent) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const p = posRef.current;
      if (p) void saveWorldState(agent, p.x, p.y);
    }, 2000);
  }, [agent]);
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      const p = posRef.current;
      if (agent && p) void saveWorldState(agent, p.x, p.y);
    }
  }, [agent]);

  const battleRef = useRef(battle);
  battleRef.current = battle;

  const move = useCallback(
    (dir: Dir) => {
      const p = posRef.current;
      if (!p || battleRef.current) return; // 戦闘中は移動不可
      const { dx, dy } = DIRS[dir];
      const nx = wrap(p.x + dx);
      const ny = wrap(p.y + dy);
      const terrain = terrainAt(nx, ny);
      if (!isWalkable(terrain)) {
        setBlocked(true); // 「そっちには進めない」フィードバック
        return; // 位置不変なので保存もしない
      }
      setBlocked(false);
      setPos({ x: nx, y: ny });
      scheduleSave();
      // 野外遭遇 (プレビュー: Math.random。本実装は PR-W3 で Worker の署名付き seed に)
      const d = diag;
      if (d && Math.random() < encounterRateFor(terrain)) {
        const danger = regionDanger(regionOf(nx, ny));
        const tier = (danger <= 1 ? 1 : danger === 2 ? 2 : 3) as 1 | 2 | 3;
        const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
        const state = startBattle(
          d.archetype,
          jobLevelFromXp(d.jobLevel?.xp ?? 0),
          playerLevelFromXp(d.playerLevel?.xp ?? 0),
          session.handle?.split('.')[0] ?? 'あなた',
          tier,
          seed,
          0, // プレビューはやくそう持ち込みなし
        );
        setBattle({ state, busy: false });
      }
    },
    [scheduleSave, diag, session.handle],
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
      // 決着。プレビューでは報酬・記録なし。敗北時は最寄りの街へ (docs/19 §6)。
      let movedToTown: string | null = null;
      if (next.outcome === 'lose') {
        const p = posRef.current;
        if (p) {
          const towns = worldOverlay().towns;
          let best = towns[0]!;
          let bestD = Infinity;
          for (const t of towns) {
            const ddx = Math.min(Math.abs(t.x - p.x), 1024 - Math.abs(t.x - p.x));
            const ddy = Math.min(Math.abs(t.y - p.y), 1024 - Math.abs(t.y - p.y));
            if (ddx + ddy < bestD) { bestD = ddx + ddy; best = t; }
          }
          setPos({ x: best.x, y: best.y });
          scheduleSave();
          movedToTown = best.name;
        }
      }
      setBattle(null);
      setBattleResult({ state: next, movedToTown });
    },
    [scheduleSave],
  );

  // 位置リセット (プレビュー用): はじまりの街へ戻る
  const resetToSpawn = useCallback(() => {
    const spawn = worldOverlay().spawn;
    setBattle(null);
    setBattleResult(null);
    setPos({ x: spawn.x, y: spawn.y });
    scheduleSave();
  }, [scheduleSave]);

  // キーボード (PC)。修飾キー付き (Cmd+← のブラウザ戻る等) は奪わない。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!posRef.current) return;
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
  if (!pos) return <p>世界を読み込んでいる…</p>;

  // ─── 野外遭遇 (戦闘中はマップの代わりにバトル画面) ───
  if (battle) {
    const danger = regionDanger(regionOf(pos.x, pos.y));
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
          <p style={{ fontSize: '0.85em' }}>気がつくと「{movedToTown}」に運ばれていた…</p>
        )}
        <p style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>※ プレビュー中の戦闘に報酬・記録・パワー消費はありません</p>
        <button type="button" onClick={() => setBattleResult(null)} style={{ padding: '0.7em 1.6em' }}>
          マップへ戻る
        </button>
      </div>
    );
  }

  const town = townAt(pos.x, pos.y);
  const here = terrainAt(pos.x, pos.y);
  const danger = regionDanger(regionOf(pos.x, pos.y));

  // ビューポートのタイル列 (プレイヤー中央固定)。平地は見た目バリアントを散らす。
  const tiles = [];
  for (let vy = 0; vy < VIEW; vy++) {
    for (let vx = 0; vx < VIEW; vx++) {
      const x = wrap(pos.x - HALF + vx);
      const y = wrap(pos.y - HALF + vy);
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
          ({pos.x}, {pos.y})
        </span>
      </div>
      <p style={{ margin: '0.2em 0 0.5em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
        {blocked ? (
          <strong style={{ color: 'var(--color-fg)' }}>そっちには進めない!</strong>
        ) : town ? (
          <strong style={{ color: 'var(--color-fg)' }}>🏘 {town.name}</strong>
        ) : (
          <>このあたり: {DANGER_LABELS[danger]}{here === 'forest' ? ' / 深い森…' : ''}</>
        )}
        <span style={{ marginLeft: '0.6em', opacity: 0.8 }}>※ プレビュー中はパワー消費・遭遇なし</span>
      </p>

      {/* マップ本体。アバターは SVG 外の HTML オーバーレイ (装備が枠外に出るため)。 */}
      <div className="dq-window" style={{ padding: 4 }}>
        <div ref={mapRef} style={{ position: 'relative' }}>
          <svg
            viewBox={`0 0 ${VIEW * TILE} ${VIEW * TILE}`}
            style={{ display: 'block', width: '100%' }}
            aria-label="ワールドマップ"
          >
            {tiles}
            {/* プレイヤーの足元の影 */}
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

      {/* 十字キー (親指ゾーン) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gap: 6, justifyContent: 'center', marginTop: '0.8em' }}>
        <span />
        <DirButton dir="up" onMove={move} />
        <span />
        <DirButton dir="left" onMove={move} />
        <DirButton dir="down" onMove={move} />
        <DirButton dir="right" onMove={move} />
      </div>
      <p style={{ textAlign: 'center', fontSize: '0.72em', color: 'var(--color-muted)', marginTop: '0.4em' }}>
        PC は矢印キーでも移動できます。池・川・海・山は今は通れません。
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
