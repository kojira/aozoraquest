import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiagnosisResult } from '@aozoraquest/core';
import { jobDisplayName } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import { seedAnalysis } from '@/lib/analysis-cache';
import {
  computeFollowResonanceRanking,
  RECENCY_DAYS,
  type ResonanceRankEntry,
  type ResonanceRankPhase,
  type ResonanceRankStats,
  type ResonanceSource,
} from '@/lib/follows-resonance';
import { Avatar } from '@/components/avatar';
import { VirtualFeed } from '@/components/virtual-feed';

type RunState =
  | { status: 'pre-check' }
  | { status: 'no-self-analysis' }
  | {
      status: 'running';
      phase: ResonanceRankPhase | 'starting';
      done?: number;
      total?: number;
      currentHandle?: string;
      ranking?: ResonanceRankEntry[];
      stats?: ResonanceRankStats;
    }
  | { status: 'done'; ranking: ResonanceRankEntry[]; stats: ResonanceRankStats }
  | { status: 'error'; error: string };

const PHASE_LABEL: Record<ResonanceRankPhase | 'starting', string> = {
  starting: '準備しています',
  follows: 'フォロー一覧を集めています',
  recency: `この ${RECENCY_DAYS} 日間の活動を確認しています`,
  analysis: '既に診断済の相手を探しています',
  scoring: '相性を計算しています',
  diagnosing: 'まだ診断されていない相手を裏で診断中',
};

export function Friends() {
  const session = useSession();
  const [state, setState] = useState<RunState>({ status: 'pre-check' });
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    cancelledRef.current = false;
    (async () => {
      const mine = await getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null);
      if (cancelledRef.current) return;
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
          (ev) => {
            if (cancelledRef.current) return;
            if (ev.phase === 'partial') {
              setState((prev) => {
                if (prev.status !== 'running') return prev;
                return { ...prev, ranking: ev.ranking, stats: ev.stats };
              });
            } else {
              setState((prev) => {
                if (prev.status !== 'running') return prev;
                const next: typeof prev = {
                  status: 'running',
                  phase: ev.phase,
                  done: ev.done,
                  total: ev.total,
                };
                if (prev.ranking) next.ranking = prev.ranking;
                if (prev.stats) next.stats = prev.stats;
                if ('currentHandle' in ev && ev.currentHandle) next.currentHandle = ev.currentHandle;
                return next;
              });
            }
          },
          () => cancelledRef.current,
        );
        if (cancelledRef.current) return;
        setState({ status: 'done', ranking: result.ranking, stats: result.stats });
      } catch (e) {
        if (cancelledRef.current) return;
        setState({ status: 'error', error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
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
        フォローしている人の中から、直近 {RECENCY_DAYS} 日以内に投稿している相手との
        相性を並べます。未診断の相手はこの画面で裏診断します (初回のみ時間がかかります)。
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

      {state.status === 'done' && (
        <>
          <StatsLine stats={state.stats} />
          <RankingList ranking={state.ranking} statsForEmpty={state.stats} />
        </>
      )}
    </div>
  );
}

function RunningView({ state }: { state: Extract<RunState, { status: 'running' }> }) {
  const pct =
    typeof state.done === 'number' && typeof state.total === 'number' && state.total > 0
      ? Math.min(100, Math.max(0, (state.done / state.total) * 100))
      : null;
  const label = PHASE_LABEL[state.phase];
  return (
    <div style={{ marginTop: '1em' }}>
      <p>
        <strong>{label}</strong>
        {state.done !== undefined && state.total !== undefined && ` (${state.done}/${state.total})`}
      </p>
      {state.phase === 'diagnosing' && state.currentHandle && (
        <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginTop: '-0.2em' }}>
          診断中: @{state.currentHandle}
        </p>
      )}
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

      {/* 裏診断中でも現時点のランキングを見せる */}
      {state.stats && <StatsLine stats={state.stats} />}
      {state.ranking && state.ranking.length > 0 && (
        <RankingList ranking={state.ranking} statsForEmpty={state.stats} />
      )}
    </div>
  );
}

function StatsLine({ stats }: { stats?: ResonanceRankStats }) {
  if (!stats) return null;
  return (
    <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', margin: '0.8em 0' }}>
      フォロー {stats.totalFollows} / {RECENCY_DAYS} 日以内投稿 {stats.recentlyActive} /{' '}
      診断済 <span style={{ color: 'var(--color-accent)' }}>{stats.pdsAnalyzed}</span> +{' '}
      裏診断済 <span style={{ color: 'var(--color-accent)' }}>{stats.idbCached + stats.freshlyDiagnosed}</span>
      {stats.pendingDiagnoses > 0 && (
        <> + 残り {stats.pendingDiagnoses} 件裏診断中</>
      )}
    </p>
  );
}

function RankingList({ ranking, statsForEmpty }: { ranking: ResonanceRankEntry[]; statsForEmpty?: ResonanceRankStats | undefined }) {
  const empty = useMemo(() => {
    if (ranking.length > 0) return null;
    if (!statsForEmpty) return null;
    if (statsForEmpty.totalFollows === 0) return 'フォローしている人がまだいません。';
    if (statsForEmpty.recentlyActive === 0)
      return `直近 ${RECENCY_DAYS} 日間に投稿しているフォロー先が見つかりませんでした。`;
    return '相性を計算できる相手が見つかりませんでした。';
  }, [ranking, statsForEmpty]);

  if (empty) return <p style={{ color: 'var(--color-muted)' }}>{empty}</p>;
  return (
    <VirtualFeed
      items={ranking}
      keyOf={(e) => e.did}
      estimateSize={92}
      overscan={6}
      renderItem={(entry, i) => <RankRow entry={entry} rank={i + 1} />}
    />
  );
}

const SOURCE_LABEL: Record<ResonanceSource, string> = {
  pds: '診断済',
  idb: '裏診断(保存済)',
  onnx: '裏診断',
};

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
        <div style={{ fontSize: '0.78em', color: 'var(--color-muted)' }}>
          <span style={{ color: 'var(--color-accent)' }}>{entry.pairRelation.label}</span>
          {' · '}
          <span>{entry.label}</span>
          {' · '}
          <span style={{ opacity: 0.7 }}>{SOURCE_LABEL[entry.source]}</span>
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
