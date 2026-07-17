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
import { Avatar } from '@/components/avatar';
import { TERRAIN_TILES } from '@/components/world-tiles';

/**
 * あおぞらワールド (docs/19-overworld.md) — PR-W2: 散歩プレビュー。
 *
 * 16×16 ビューポートでプレイヤー中央固定、1 タップ 1 マス移動。トーラス wrap。
 * この段階では**パワー消費なし・遭遇なし** (消費と判定は PR-W3 で Worker に移る)。
 * 位置は PDS (world/self) に保存 (デバウンス)。
 */

const VIEW = 16; // ビューポートの一辺 (タイル数)
const HALF = VIEW / 2;
const TILE = 32; // SVG 内の 1 タイルサイズ (表示は width 100% で縮尺)

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Record<Dir, { dx: number; dy: number; label: string }> = {
  up: { dx: 0, dy: -1, label: '↑' },
  down: { dx: 0, dy: 1, label: '↓' },
  left: { dx: -1, dy: 0, label: '←' },
  right: { dx: 1, dy: 0, label: '→' },
};

const DANGER_LABELS = ['おだやか', 'すこし危険', '危険', 'とても危険'] as const;

export function World() {
  const session = useSession();
  const agent = session.agent ?? null;
  const did = session.did ?? null;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [archetype, setArchetype] = useState<DiagnosisResult['archetype'] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初期ロード: 位置 + アバター + ジョブ
  useEffect(() => {
    if (session.status !== 'signed-in' || !agent || !did) return;
    let cancelled = false;
    (async () => {
      const [state, profile, diag] = await Promise.all([
        loadWorldState(agent, did),
        agent.getProfile({ actor: did }).catch(() => null),
        getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
      ]);
      if (cancelled) return;
      setPos({ x: state.x, y: state.y });
      setAvatarUrl(profile?.data.avatar ?? null);
      setArchetype(diag?.archetype ?? null);
    })();
    return () => { cancelled = true; };
  }, [session.status, agent, did]);

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
      setPos((p) => {
        if (!p) return p;
        const { dx, dy } = DIRS[dir];
        const nx = wrap(p.x + dx);
        const ny = wrap(p.y + dy);
        if (!isWalkable(terrainAt(nx, ny))) return p; // 通行不能
        return { x: nx, y: ny };
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  // キーボード (PC)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.3em' }}>
        <h2 style={{ margin: 0 }}>あおぞらワールド <span style={{ fontSize: '0.6em', color: 'var(--color-muted)' }}>(散歩プレビュー)</span></h2>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)', fontFamily: 'ui-monospace, monospace' }}>
          ({pos.x}, {pos.y})
        </span>
      </div>
      <p style={{ margin: '0.2em 0 0.5em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
        {town ? (
          <strong style={{ color: 'var(--color-fg)' }}>🏘 {town.name}</strong>
        ) : (
          <>このあたり: {DANGER_LABELS[danger]}{here === 'forest' ? ' / 深い森…' : ''}</>
        )}
        <span style={{ marginLeft: '0.6em', opacity: 0.8 }}>※ プレビュー中はパワー消費・遭遇なし</span>
      </p>

      {/* マップ本体 */}
      <div className="dq-window" style={{ padding: 4 }}>
        <svg
          viewBox={`0 0 ${VIEW * TILE} ${VIEW * TILE}`}
          style={{ display: 'block', width: '100%', imageRendering: 'pixelated' }}
          aria-label="ワールドマップ"
        >
          {tiles}
          {/* プレイヤー (中央): 実アバター + 白リング */}
          <g transform={`translate(${HALF * TILE},${HALF * TILE})`}>
            <circle cx={TILE / 2} cy={TILE / 2} r={TILE / 2 - 1} fill="rgba(0,0,0,0.25)" />
            <foreignObject x={2} y={2} width={TILE - 4} height={TILE - 4}>
              <div style={{ width: '100%', height: '100%' }}>
                <Avatar src={avatarUrl ?? undefined} size={TILE - 4} archetype={archetype} />
              </div>
            </foreignObject>
            <circle cx={TILE / 2} cy={TILE / 2} r={TILE / 2 - 2} fill="none" stroke="#ffffff" strokeWidth={2} />
          </g>
        </svg>
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
      aria-label={`${DIRS[dir].label} に移動`}
      onClick={() => onMove(dir)}
      style={{ height: 56, fontSize: '1.4em', padding: 0 }}
    >
      {DIRS[dir].label}
    </button>
  );
}
