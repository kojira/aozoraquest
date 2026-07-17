import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiagnosisResult } from '@aozoraquest/core';
import {
  isWalkable,
  regionDanger,
  regionOf,
  terrainAt,
  townAt,
  wrap,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import { loadWorldState, saveWorldState } from '@/lib/world-state';
import { WORLD_PREVIEW_ENABLED } from '@/lib/world-preview';
import { Avatar } from '@/components/avatar';
import { TERRAIN_TILES } from '@/components/world-tiles';

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
  const [archetype, setArchetype] = useState<DiagnosisResult['archetype'] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      setArchetype(diag?.archetype ?? null);
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

  const move = useCallback(
    (dir: Dir) => {
      const p = posRef.current;
      if (!p) return;
      const { dx, dy } = DIRS[dir];
      const nx = wrap(p.x + dx);
      const ny = wrap(p.y + dy);
      if (!isWalkable(terrainAt(nx, ny))) {
        setBlocked(true); // 「そっちには進めない」フィードバック
        return; // 位置不変なので保存もしない
      }
      setBlocked(false);
      setPos({ x: nx, y: ny });
      scheduleSave();
    },
    [scheduleSave],
  );

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

  const town = townAt(pos.x, pos.y);
  const here = terrainAt(pos.x, pos.y);
  const danger = regionDanger(regionOf(pos.x, pos.y));

  // ビューポートのタイル列 (プレイヤー中央固定)
  const tiles = [];
  for (let vy = 0; vy < VIEW; vy++) {
    for (let vx = 0; vx < VIEW; vx++) {
      const x = wrap(pos.x - HALF + vx);
      const y = wrap(pos.y - HALF + vy);
      tiles.push(
        <g key={`${vx}-${vy}`} transform={`translate(${vx * TILE},${vy * TILE})`}>
          {TERRAIN_TILES[terrainAt(x, y)]}
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
      </p>
    </div>
  );
}

function DirButton({ dir, onMove }: { dir: Dir; onMove: (d: Dir) => void }) {
  return (
    <button
      type="button"
      aria-label={DIRS[dir].label}
      onClick={() => onMove(dir)}
      style={{
        height: 56,
        fontSize: '1.4em',
        padding: 0,
        // 連打でダブルタップズームを誘発しない (iOS)
        touchAction: 'manipulation',
      }}
    >
      {DIRS[dir].glyph}
    </button>
  );
}
