import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AtpAgent } from '@atproto/api';
import type { Archetype, DiagnosisResult } from '@aozoraquest/core';
import { DIAGNOSIS_MIN_POST_COUNT, JOBS_BY_ID, jobDisplayName, jobLevelFromXp, jobTagline, jobXpToNextLevel, playerLevelFromXp, playerXpToNextLevel } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { runDiagnosis } from '@/lib/diagnosis-flow';
import { getRecord } from '@/lib/atproto';
import { JOB_CHANGE_STREAK_THRESHOLD, confirmJobChange, dismissPendingArchetype } from '@/lib/post-processor';
import { RadarChart } from '@/components/radar-chart';
import { SpiritBubble } from '@/components/spirit-bubble';
import { Avatar } from '@/components/avatar';

type DiagnosisState =
  | { status: 'idle' }
  | { status: 'running'; phase: string; done?: number; total?: number }
  | { status: 'insufficient'; postCount: number }
  | { status: 'done'; result: DiagnosisResult }
  | { status: 'error'; error: string };

interface Profile {
  targetJob?: string;
  updatedAt?: string;
}

export function MyProfile() {
  const session = useSession();
  const navigate = useNavigate();
  const [state, setState] = useState<DiagnosisState>({ status: 'idle' });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [targetArchetype, setTargetArchetype] = useState<Archetype | null>(null);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    let cancelled = false;
    (async () => {
      try {
        const existing = await getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self');
        if (cancelled) return;
        // 診断実行中 (running) や結果表示中 (done/error/insufficient) を勝手に上書きしない。
        // idle の時だけ既存レコードを反映する。
        setState((prev) => {
          if (prev.status !== 'idle') return prev;
          return existing ? { status: 'done', result: existing } : prev;
        });
      } catch (e) {
        console.warn('existing analysis load failed', e);
      }
    })();
    // 自分の Bluesky プロフィールのアバター画像を取る (公開 AppView 経由)
    (async () => {
      try {
        const publicAgent = new AtpAgent({ service: 'https://api.bsky.app' });
        const res = await publicAgent.getProfile({ actor: did });
        if (!cancelled && res.data.avatar) setAvatarUrl(res.data.avatar);
      } catch (e) {
        console.warn('self avatar fetch failed', e);
      }
    })();
    // 目指すジョブ (app.aozoraquest.profile/self の targetJob)
    (async () => {
      try {
        const p = await getRecord<Profile>(agent, did, 'app.aozoraquest.profile', 'self');
        if (!cancelled && p?.targetJob && p.targetJob in JOBS_BY_ID) {
          setTargetArchetype(p.targetJob as Archetype);
        }
      } catch (e) {
        console.warn('target job load failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [session.status, session.agent, session.did]);

  if (session.status !== 'signed-in' || !session.agent) {
    return (
      <div>
        <p>まずはログインしてください。</p>
        <button onClick={() => navigate('/onboarding')}>ログイン</button>
      </div>
    );
  }

  const agent = session.agent;

  async function runAgain() {
    setState({ status: 'running', phase: 'starting' });
    try {
      const result = await runDiagnosis(agent, (phase, done, total) => {
        const next: DiagnosisState = { status: 'running', phase };
        if (done !== undefined) next.done = done;
        if (total !== undefined) next.total = total;
        setState(next);
      });
      if ('insufficient' in result) {
        setState({ status: 'insufficient', postCount: result.postCount });
      } else {
        setState({ status: 'done', result });
      }
    } catch (e) {
      setState({ status: 'error', error: String((e as Error)?.message ?? e) });
    }
  }

  const myArchetype: Archetype | null =
    state.status === 'done' && state.result.archetype && state.result.archetype in JOBS_BY_ID
      ? (state.result.archetype as Archetype)
      : null;
  const myJobXp = state.status === 'done' ? (state.result.jobLevel?.xp ?? 0) : 0;
  const myJobLv = jobLevelFromXp(myJobXp);
  const myPlayerXp = state.status === 'done' ? (state.result.playerLevel?.xp ?? 0) : 0;
  const myPlayerLv = playerLevelFromXp(myPlayerXp);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8em' }}>
        <Avatar src={avatarUrl ?? undefined} size={72} archetype={myArchetype} />
        <div>
          <h2 style={{ margin: 0 }}>{session.handle ?? '自分'}</h2>
          {myArchetype && (
            <p style={{ margin: 0, fontSize: '0.85em', color: 'var(--color-muted)' }}>
              <span style={{ color: 'var(--color-muted)' }}>今:</span>{' '}
              {jobDisplayName(myArchetype, 'default')}
              <span style={{ marginLeft: '0.4em', fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent)' }}>
                LV{myJobLv}
              </span>
              <span style={{ marginLeft: '0.5em', fontSize: '0.9em' }}>{jobTagline(myArchetype)}</span>
            </p>
          )}
          {state.status === 'done' && (
            <p style={{ margin: '0.15em 0 0', fontSize: '0.8em', color: 'var(--color-muted)' }}>
              <span>全体:</span>{' '}
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>LV{myPlayerLv}</span>
              <span style={{ marginLeft: '0.5em', opacity: 0.8 }}>(累計 {myPlayerXp} XP)</span>
            </p>
          )}
          <p style={{ margin: '0.15em 0 0', fontSize: '0.85em', color: 'var(--color-muted)' }}>
            <span style={{ color: 'var(--color-muted)' }}>目指す:</span>{' '}
            {targetArchetype ? (
              <>
                <span style={{ color: 'var(--color-fg)' }}>{jobDisplayName(targetArchetype, 'default')}</span>
                <span style={{ marginLeft: '0.5em', fontSize: '0.9em' }}>{jobTagline(targetArchetype)}</span>
                <Link to="/settings" style={{ marginLeft: '0.6em', fontSize: '0.85em' }}>変更</Link>
              </>
            ) : (
              <Link to="/settings">目指す姿を選ぶ</Link>
            )}
          </p>
        </div>
      </div>

      {state.status === 'done' && state.result.pendingArchetype && (state.result.pendingArchetypeStreak ?? 0) >= JOB_CHANGE_STREAK_THRESHOLD && (
        <JobChangeBanner
          current={state.result.archetype}
          pending={state.result.pendingArchetype}
          streak={state.result.pendingArchetypeStreak ?? 0}
          onConfirm={async () => {
            if (session.status !== 'signed-in' || !session.agent || !session.did) return;
            const next = await confirmJobChange(session.agent, session.did, state.result.pendingArchetype!);
            if (next) setState({ status: 'done', result: next });
          }}
          onDismiss={async () => {
            if (session.status !== 'signed-in' || !session.agent || !session.did) return;
            await dismissPendingArchetype(session.agent, session.did);
            setState({
              status: 'done',
              result: (() => {
                const r = { ...state.result };
                delete r.pendingArchetype;
                delete r.pendingArchetypeStreak;
                return r;
              })(),
            });
          }}
        />
      )}

      {state.status === 'idle' && (
        <div style={{ marginTop: '1em' }}>
          <p>まだあなたの気質を調べていません。</p>
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
            あなたの Bluesky の投稿を読み、どんな考え方のクセがあるかを見つけます。
            投稿の中身は一切アプリ外に送りません (ブラウザの中だけで処理)。
          </p>
          <button onClick={runAgain}>気質を調べる</button>
        </div>
      )}

      {state.status === 'running' && (
        <div style={{ marginTop: '1em' }}>
          <p>
            <strong>{phaseLabel(state.phase)}</strong>
            {state.done !== undefined && state.total !== undefined && ` (${state.done}/${state.total})`}
          </p>
          <div style={{ height: '6px', background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                width: state.total && state.done !== undefined ? `${(state.done / state.total) * 100}%` : '20%',
                height: '100%',
                background: 'var(--color-primary)',
                transition: 'width 0.2s',
              }}
            />
          </div>
          <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginTop: '0.5em' }}>
            初回はアプリが使うファイル (約 37MB) を読み込みます。1 分ほどかかります。
          </p>
        </div>
      )}

      {state.status === 'insufficient' && (
        <div style={{ marginTop: '1em' }}>
          <SpiritBubble>まだ歩みが浅い。もう少し投稿してから、改めて来てくれ。</SpiritBubble>
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', marginTop: '0.5em' }}>
            見つかった投稿 {state.postCount} 件 (判定には {DIAGNOSIS_MIN_POST_COUNT} 件以上必要です)。
          </p>
        </div>
      )}

      {state.status === 'error' && (
        <div style={{ marginTop: '1em' }}>
          <p style={{ color: '#b00' }}>うまく調べられませんでした: {state.error}</p>
          <button onClick={runAgain}>もう一度試す</button>
        </div>
      )}

      {state.status === 'done' && <ResultView result={state.result} onRerun={runAgain} />}

      <div style={{ marginTop: '2em' }}>
        <Link to="/settings">設定</Link>
      </div>
    </div>
  );
}

function phaseLabel(phase: string): string {
  const MAP: Record<string, string> = {
    starting: '準備しています',
    'fetching-posts': 'あなたの投稿を集めています',
    'loading-prototypes': '手がかりを読み込んでいます',
    'embedding-posts': '投稿を読み解いています',
    analyzing: '気質の形を描いています',
    saving: '結果を保存しています',
    done: '完了',
  };
  return MAP[phase] ?? phase;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '強い手応え',
  medium: 'ほどほどの手応え',
  low: '弱い手応え',
  ambiguous: '揺れあり',
  insufficient: '材料不足',
};

const COGNITIVE_LABEL: Record<string, string> = {
  Ni: 'ひらめき (内向き)',
  Ne: 'ひらめき (外向き)',
  Si: '記憶・慣習',
  Se: 'その場の感覚',
  Ti: '理屈を組み立てる',
  Te: '段取り・実行',
  Fi: '価値観',
  Fe: '場の調和',
};

function ResultView({ result, onRerun }: { result: DiagnosisResult; onRerun: () => void }) {
  const jobName = jobDisplayName(result.archetype, 'default');
  const tagline = jobTagline(result.archetype);
  const conf = CONFIDENCE_LABEL[result.confidence] ?? result.confidence;
  const jobXp = result.jobLevel?.xp ?? 0;
  const jobLv = jobXpToNextLevel(jobXp);
  const jobPct = jobLv.next > 0 ? Math.min(1, jobLv.current / jobLv.next) * 100 : 100;
  const playerXp = result.playerLevel?.xp ?? 0;
  const playerLv = playerXpToNextLevel(playerXp);
  const playerPct = playerLv.next > 0 ? Math.min(1, playerLv.current / playerLv.next) * 100 : 100;
  return (
    <section style={{ marginTop: '1em' }}>
      <h3 style={{ fontSize: '1em' }}>
        今の姿: {jobName}
        <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent)', marginLeft: '0.4em' }}>LV{jobLv.level}</span>
        {tagline && <span style={{ fontSize: '0.8em', fontWeight: 400, color: 'var(--color-muted)', marginLeft: '0.5em' }}>{tagline}</span>}
      </h3>
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
        {result.analyzedPostCount} 件の投稿から読み取りました · {conf}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1em', marginTop: '0.8em', flexWrap: 'wrap' }}>
        <RadarChart stats={result.rpgStats} size={180} normalize showValues={false} />
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: '0.95em' }}>
          <StatRow label="攻 ATK" value={result.rpgStats.atk} color="var(--color-atk)" />
          <StatRow label="守 DEF" value={result.rpgStats.def} color="var(--color-def)" />
          <StatRow label="速 AGI" value={result.rpgStats.agi} color="var(--color-agi)" />
          <StatRow label="知 INT" value={result.rpgStats.int} color="var(--color-int)" />
          <StatRow label="運 LUK" value={result.rpgStats.luk} color="var(--color-luk)" />
        </ul>
      </div>

      <div style={{ marginTop: '0.8em', maxWidth: '28em', display: 'flex', flexDirection: 'column', gap: '0.5em' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', color: 'var(--color-muted)', fontFamily: 'ui-monospace, monospace' }}>
            <span>{jobName} LV{jobLv.level} → LV{jobLv.level + 1}</span>
            <span>{jobLv.next > 0 ? `${jobLv.current} / ${jobLv.next} XP` : `MAX (累計 ${jobXp} XP)`}</span>
          </div>
          <div style={{ height: 5, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden', marginTop: '0.2em' }}>
            <div style={{ width: `${jobPct}%`, height: '100%', background: 'var(--color-accent)' }} />
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', color: 'var(--color-muted)', fontFamily: 'ui-monospace, monospace' }}>
            <span>全体 LV{playerLv.level} → LV{playerLv.level + 1}</span>
            <span>{playerLv.next > 0 ? `${playerLv.current} / ${playerLv.next} XP` : `MAX (累計 ${playerXp} XP)`}</span>
          </div>
          <div style={{ height: 5, background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden', marginTop: '0.2em' }}>
            <div style={{ width: `${playerPct}%`, height: '100%', background: 'var(--color-luk)' }} />
          </div>
        </div>
      </div>

      <h4 style={{ fontSize: '0.95em', marginTop: '1em' }}>考え方のクセ</h4>
      <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.2em' }}>
        8 つの傾向を 100 点満点で表示しています。
      </p>
      <ul style={{ fontSize: '0.85em', color: 'var(--color-muted)', listStyle: 'none', padding: 0 }}>
        {Object.entries(result.cognitiveScores)
          .sort((a, b) => b[1] - a[1])
          .map(([fn, score]) => (
            <li key={fn}>
              <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent)' }}>({fn})</span>{' '}
              {COGNITIVE_LABEL[fn] ?? fn}: {score}
            </li>
          ))}
      </ul>

      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginTop: '1em' }}>
        最後に調べた日時: {new Date(result.analyzedAt).toLocaleString()}
      </p>

      <button onClick={onRerun} style={{ marginTop: '1em' }}>もう一度調べる</button>
    </section>
  );
}

function JobChangeBanner({
  current,
  pending,
  streak,
  onConfirm,
  onDismiss,
}: {
  current: Archetype;
  pending: Archetype;
  streak: number;
  onConfirm: () => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const handle = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  return (
    <section
      style={{
        marginTop: '1em',
        padding: '0.8em',
        border: '2px solid var(--color-accent)',
        borderRadius: 4,
        background: 'rgba(159, 215, 255, 0.08)',
      }}
    >
      <p style={{ margin: 0, fontWeight: 700 }}>
        最近の投稿は <strong>{jobDisplayName(pending, 'default')}</strong> に近づいています
      </p>
      <p style={{ margin: '0.3em 0 0.6em', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        今は「{jobDisplayName(current, 'default')}」のまま。{streak} 投稿連続で {jobDisplayName(pending, 'default')} 寄りに判定されました。
        転職すると現ジョブの LV・XP はリセットされ、新しいジョブで 0 から育て直しになります
        (全体 LV は維持されます)。
      </p>
      <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={() => void handle(onConfirm)}>
          {jobDisplayName(pending, 'default')} に転職する
        </button>
        <button className="secondary" disabled={busy} onClick={() => void handle(onDismiss)}>
          このまま続ける
        </button>
      </div>
    </section>
  );
}

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '0.6em', padding: '0.15em 0' }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ minWidth: '4.5em', color: 'var(--color-muted)' }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: '1.05em', minWidth: '2em', textAlign: 'right' }}>{value}</span>
    </li>
  );
}
