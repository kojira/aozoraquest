import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiagnosisResult } from '@aozoraquest/core';
import { jobDisplayName } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { seedAnalysis } from '@/lib/analysis-cache';
import {
  computeFollowResonanceRanking,
  RECENCY_DAYS,
  type ResonanceRankEntry,
  type ResonanceRankPhase,
  type ResonanceRankResult,
} from '@/lib/follows-resonance';
import { Avatar } from '@/components/avatar';
import { VirtualFeed } from '@/components/virtual-feed';

type RunState =
  | { status: 'pre-check' }
  | { status: 'no-self-analysis' }
  | { status: 'running'; phase: ResonanceRankPhase | 'starting'; done?: number; total?: number }
  | { status: 'done'; result: ResonanceRankResult }
  | { status: 'error'; error: string };

const PHASE_LABEL: Record<ResonanceRankPhase | 'starting', string> = {
  starting: '準備しています',
  follows: 'フォロー一覧を集めています',
  recency: `この ${RECENCY_DAYS} 日間の活動を確認しています`,
  analysis: '相手の気質を照合しています',
  scoring: '相性を計算しています',
};

export function Friends() {
  const session = useSession();
  const [state, setState] = useState<RunState>({ status: 'pre-check' });

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    let cancelled = false;
    (async () => {
      // 自分の診断レコードを取る。無ければ先に /me で診断してもらう
      const mine = await getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self').catch(() => null);
      if (cancelled) return;
      if (!mine) {
        setState({ status: 'no-self-analysis' });
        return;
      }
      seedAnalysis(did, mine);
      setState({ status: 'running', phase: 'starting' });
      try {
        const result = await computeFollowResonanceRanking(
          agent,
          did,
          mine,
          (phase, done, total) => {
            if (cancelled) return;
            setState({ status: 'running', phase, done, total });
          },
        );
        if (cancelled) return;
        setState({ status: 'done', result });
      } catch (e) {
        if (cancelled) return;
        setState({ status: 'error', error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => { cancelled = true; };
  }, [session.status, session.agent, session.did]);

  if (session.status !== 'signed-in') {
    return (
      <div>
        <h2>相性ランキング</h2>
        <p>まずはログインしてください。</p>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>相性ランキング</h2>
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
        フォローしている人の中から、直近 {RECENCY_DAYS} 日以内に投稿していて
        AozoraQuest で診断を受けた相手との相性を並べます。
      </p>

      {state.status === 'pre-check' && <p>読み込み中…</p>}

      {state.status === 'no-self-analysis' && (
        <div style={{ marginTop: '1em' }}>
          <p>まずは自分の気質を調べてください。</p>
          <Link to="/me">
            <button>気質を調べる</button>
          </Link>
        </div>
      )}

      {state.status === 'running' && <RunningView state={state} />}

      {state.status === 'error' && (
        <div style={{ marginTop: '1em' }}>
          <p style={{ color: 'var(--color-danger)' }}>うまく計算できませんでした。</p>
          <pre style={{ fontSize: '0.75em', color: 'var(--color-muted)', whiteSpace: 'pre-wrap' }}>{state.error}</pre>
        </div>
      )}

      {state.status === 'done' && <RankingView result={state.result} />}
    </div>
  );
}

function RunningView({ state }: { state: Extract<RunState, { status: 'running' }> }) {
  const pct =
    typeof state.done === 'number' && typeof state.total === 'number' && state.total > 0
      ? Math.min(100, Math.max(0, (state.done / state.total) * 100))
      : null;
  return (
    <div style={{ marginTop: '1em' }}>
      <p>
        <strong>{PHASE_LABEL[state.phase]}</strong>
        {state.done !== undefined && state.total !== undefined && ` (${state.done}/${state.total})`}
      </p>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '10px',
          background: 'rgba(255,255,255,0.2)',
          border: '1px solid rgba(255,255,255,0.6)',
          borderRadius: 5,
          overflow: 'hidden',
        }}
      >
        <div style={{
          width: `${pct ?? 20}%`,
          height: '100%',
          background: 'var(--color-accent)',
          transition: 'width 0.1s linear',
        }} />
      </div>
    </div>
  );
}

function RankingView({ result }: { result: ResonanceRankResult }) {
  const { ranking, stats } = result;

  const summary = useMemo(() => {
    return `フォロー ${stats.totalFollows} 人 / ${RECENCY_DAYS} 日以内に投稿 ${stats.recentlyActive} 人 / うち診断済 ${stats.analyzed} 人`;
  }, [stats]);

  return (
    <div style={{ marginTop: '1em' }}>
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{summary}</p>

      {ranking.length === 0 ? (
        <EmptyView stats={stats} />
      ) : (
        <VirtualFeed
          items={ranking}
          keyOf={(e) => e.did}
          estimateSize={88}
          overscan={6}
          renderItem={(entry, i) => <RankRow entry={entry} rank={i + 1} />}
        />
      )}
    </div>
  );
}

function EmptyView({ stats }: { stats: ResonanceRankResult['stats'] }) {
  if (stats.totalFollows === 0) {
    return <p style={{ color: 'var(--color-muted)' }}>フォローしている人がまだいません。</p>;
  }
  if (stats.recentlyActive === 0) {
    return (
      <p style={{ color: 'var(--color-muted)' }}>
        直近 {RECENCY_DAYS} 日間に投稿しているフォロー先が見つかりませんでした。
      </p>
    );
  }
  return (
    <div style={{ color: 'var(--color-muted)' }}>
      <p>AozoraQuest で診断を受けたフォロー先がまだいません。</p>
      <p style={{ fontSize: '0.8em' }}>
        相手にも診断を受けてもらうと、ここにランキングが並びます。
      </p>
    </div>
  );
}

function RankRow({ entry, rank }: { entry: ResonanceRankEntry; rank: number }) {
  const display = entry.displayName || entry.handle;
  return (
    <Link
      to={`/profile/${entry.handle}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.8em',
        padding: '0.6em 0.4em',
        borderBottom: '1px solid rgba(255,255,255,0.15)',
        textAlign: 'left',
        color: 'inherit',
        textDecoration: 'none',
        borderBottomColor: 'rgba(255,255,255,0.15)',
      }}
    >
      <span style={{
        minWidth: '1.8em',
        fontFamily: 'ui-monospace, monospace',
        color: 'var(--color-muted)',
        textAlign: 'right',
        fontSize: '0.9em',
      }}>
        {rank}
      </span>
      <Avatar src={entry.avatar} size={44} archetype={entry.archetype} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {display}
        </div>
        <div style={{ fontSize: '0.8em', color: 'var(--color-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          @{entry.handle} · {jobDisplayName(entry.archetype, 'default')}
        </div>
        <div style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
          <span style={{ color: 'var(--color-accent)' }}>{entry.pairRelation.label}</span>
          {' · '}
          <span>{entry.label}</span>
        </div>
      </div>
      <div style={{
        fontFamily: 'ui-monospace, monospace',
        fontVariantNumeric: 'tabular-nums',
        fontSize: '1.05em',
        fontWeight: 700,
        color: 'var(--color-accent)',
        minWidth: '3.2em',
        textAlign: 'right',
      }}>
        {entry.scorePercent}%
      </div>
    </Link>
  );
}
