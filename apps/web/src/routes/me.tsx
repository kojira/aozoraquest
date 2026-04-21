import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DiagnosisResult } from '@aozoraquest/core';
import { jobDisplayName } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { runDiagnosis } from '@/lib/diagnosis-flow';
import { getRecord } from '@/lib/atproto';
import { RadarChart } from '@/components/radar-chart';

type DiagnosisState =
  | { status: 'idle' }
  | { status: 'running'; phase: string; done?: number; total?: number }
  | { status: 'insufficient'; postCount: number }
  | { status: 'done'; result: DiagnosisResult }
  | { status: 'error'; error: string };

export function MyProfile() {
  const session = useSession();
  const navigate = useNavigate();
  const [state, setState] = useState<DiagnosisState>({ status: 'idle' });

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

  return (
    <div>
      <h2>{session.handle ?? '自分'}</h2>

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
          <p>まだ歩みが浅い。もう少し投稿してから改めて来てくれ。</p>
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
            見つかった投稿 {state.postCount} 件 (判定には 50 件以上必要です)。
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
  const conf = CONFIDENCE_LABEL[result.confidence] ?? result.confidence;
  return (
    <section style={{ marginTop: '1em' }}>
      <h3 style={{ fontSize: '1em' }}>今の姿: {jobName}</h3>
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
        {result.analyzedPostCount} 件の投稿から読み取りました · {conf}
      </p>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1em' }}>
        <RadarChart stats={result.rpgStats} size={260} />
      </div>

      <h4 style={{ fontSize: '0.95em', marginTop: '1em' }}>ステータス</h4>
      <ul style={{ listStyle: 'none', padding: 0, fontFamily: 'ui-monospace, monospace' }}>
        <StatBar label="攻 ATK" value={result.rpgStats.atk} color="var(--color-atk)" />
        <StatBar label="守 DEF" value={result.rpgStats.def} color="var(--color-def)" />
        <StatBar label="速 AGI" value={result.rpgStats.agi} color="var(--color-agi)" />
        <StatBar label="知 INT" value={result.rpgStats.int} color="var(--color-int)" />
        <StatBar label="運 LUK" value={result.rpgStats.luk} color="var(--color-luk)" />
      </ul>

      <h4 style={{ fontSize: '0.95em', marginTop: '1em' }}>考え方のクセ</h4>
      <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.2em' }}>
        8 つの傾向を 100 点満点で表示しています。
      </p>
      <ul style={{ fontSize: '0.85em', color: 'var(--color-muted)', listStyle: 'none', padding: 0 }}>
        {Object.entries(result.cognitiveScores)
          .sort((a, b) => b[1] - a[1])
          .map(([fn, score]) => (
            <li key={fn}>
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

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <li style={{ margin: '0.4em 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em' }}>
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div style={{ height: '6px', background: 'var(--color-border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color }} />
      </div>
    </li>
  );
}
