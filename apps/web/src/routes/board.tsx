/**
 * 依頼クエスト一覧 (docs/15-user-quest.md §UI 設計 B)。
 *
 * Phase 1 MVP: 3 タブ「募集中」「自分が出した」「自分が応募した」のうち、
 * Phase 1 では「募集中」「自分が出した」のみ実装する (応募は Phase 2)。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/lib/session';
import {
  fetchQuestIndex,
  listIssuedQuests,
  type QuestIndex,
  type QuestIndexSummary,
} from '@/lib/quest-api';
import { isExpired, type UserQuest } from '@aozoraquest/core';
import { BookIcon, PlusIcon, CalendarIcon } from '@/components/icons';
import { ActionLink } from '@/components/action-link';

type Tab = 'open' | 'mine';

export function Board() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>('open');
  const [index, setIndex] = useState<QuestIndex | null>(null);
  const [myQuests, setMyQuests] = useState<UserQuest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchQuestIndex()
      .then((idx) => { if (!cancelled) setIndex(idx); })
      .catch((e) => { if (!cancelled) setErr(String((e as Error)?.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    let cancelled = false;
    listIssuedQuests(agent, did)
      .then((qs) => { if (!cancelled) setMyQuests(qs); })
      .catch((e) => { if (!cancelled) console.warn('[board] listIssuedQuests', e); });
    return () => { cancelled = true; };
  }, [session.status, session.agent, session.did]);

  const openQuests = useMemo(() => {
    if (!index) return [];
    return index.quests.filter((q) => q.status === 'open');
  }, [index]);

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8em', flexWrap: 'wrap', gap: '0.5em' }}>
        <h2 style={{ margin: 0, fontSize: '1.1em' }}>クエスト掲示板</h2>
        {session.status === 'signed-in' && (
          <span style={{ display: 'inline-flex', gap: '0.5em', flexWrap: 'wrap' }}>
            <ActionLink to="/me/portfolio" icon={<BookIcon size={20} />}>履歴</ActionLink>
            <ActionLink to="/board/new" icon={<PlusIcon size={20} />}>クエストを出す</ActionLink>
          </span>
        )}
      </header>
      <p style={{ margin: '0 0 0.8em' }}>
        <ActionLink to="/quests" icon={<CalendarIcon size={18} />} variant="inline">
          日次クエスト (個人用)
        </ActionLink>
      </p>

      <div className="dq-tabs" role="tablist">
        <div className={`dq-tab ${tab === 'open' ? 'active' : ''}`} role="tab" onClick={() => setTab('open')}>
          募集中 {openQuests.length > 0 && <span style={{ opacity: 0.7 }}>({openQuests.length})</span>}
        </div>
        <div className={`dq-tab ${tab === 'mine' ? 'active' : ''}`} role="tab" onClick={() => setTab('mine')}>
          自分が出した {myQuests && <span style={{ opacity: 0.7 }}>({myQuests.length})</span>}
        </div>
      </div>

      {err && <p style={{ color: 'var(--color-danger)' }}>取得に失敗しました: {err}</p>}

      {tab === 'open' && (
        <QuestList summaries={openQuests} emptyText="現在募集中のクエストはありません。" />
      )}

      {tab === 'mine' && (
        session.status === 'signed-in'
          ? <MyQuestList quests={myQuests} />
          : <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>サインインすると自分のクエストを表示できます。</p>
      )}
    </div>
  );
}

function QuestList({ summaries, emptyText }: { summaries: QuestIndexSummary[]; emptyText: string }) {
  if (summaries.length === 0) {
    return <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{emptyText}</p>;
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {summaries.map((q) => (
        <li key={q.uri}>
          <QuestCard summary={q} />
        </li>
      ))}
    </ul>
  );
}

function MyQuestList({ quests }: { quests: UserQuest[] | null }) {
  if (!quests) return <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中...</p>;
  if (quests.length === 0) return <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>まだクエストを出していません。</p>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {quests.map((q) => (
        <li key={q.uri}>
          <QuestCard summary={summaryOf(q)} expired={isExpired(q)} />
        </li>
      ))}
    </ul>
  );
}

function summaryOf(q: UserQuest): QuestIndexSummary {
  const s: QuestIndexSummary = {
    uri: q.uri,
    did: q.did,
    title: q.title,
    tags: q.tags,
    rewardPoints: q.rewardPoints,
    status: q.status,
    createdAt: q.createdAt,
  };
  if (q.deadline !== undefined) s.deadline = q.deadline;
  return s;
}

function QuestCard({ summary, expired }: { summary: QuestIndexSummary; expired?: boolean }) {
  const handle = handleFromDid(summary.did);
  return (
    <Link to={`/board/${encodeURIComponent(summary.uri)}`} style={{ textDecoration: 'none' }}>
      <div className="dq-window compact" style={{ borderColor: expired ? 'var(--color-muted)' : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5em' }}>
          <div style={{ fontWeight: 700, fontSize: '0.95em', color: 'var(--color-fg)' }}>{summary.title}</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8em', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
            {handle}P {summary.rewardPoints.toLocaleString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.3em' }}>
          {summary.tags.slice(0, 4).map((t) => <span key={t}>#{t.replace(/^#/, '')}</span>)}
          <span style={{ marginLeft: 'auto' }}>
            {expired ? '期限切れ' : summary.deadline ? `〆 ${formatDate(summary.deadline)}` : ''}
            {summary.status !== 'open' && <span style={{ marginLeft: '0.6em' }}>{labelOf(summary.status)}</span>}
          </span>
        </div>
      </div>
    </Link>
  );
}

function handleFromDid(did: string): string {
  // 簡易: handle 解決は別途キャッシュ層が要るが、Phase 1 では did の末尾だけ。
  // 実体としては「kojiraP」のように発行者を識別できれば十分。Phase 2 で AppView 経由解決を実装。
  return did.slice(0, 10).replace(/^did:plc:/, '');
}

function labelOf(status: string): string {
  if (status === 'assigned') return '受託中';
  if (status === 'reported') return '完了報告中';
  if (status === 'completed') return '完了';
  if (status === 'cancelled') return 'キャンセル';
  return status;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
