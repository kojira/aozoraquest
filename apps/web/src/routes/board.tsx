/**
 * 依頼クエスト掲示板 (docs/15-user-quest.md §UI 設計 B + E)。
 *
 * Phase 3 マルチカラム:
 *  - デスクトップ (>= 768px): 横並び複数カラム
 *  - モバイル (< 768px): 縦並び 1 カラムずつ
 *
 * 各カラム種類: open / mine / applied / tag / job / issuer
 * (board-columns.ts 参照)
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/lib/session';
import {
  fetchQuestIndex,
  listIssuedQuests,
  listMyApplications,
  type QuestIndex,
  type QuestIndexSummary,
} from '@/lib/quest-api';
import {
  isExpired,
  jobDisplayName,
  type UserQuest,
} from '@aozoraquest/core';
import {
  loadColumns,
  saveColumns,
  resetColumns,
  makeColumn,
  defaultTitleFor,
  JOB_OPTIONS,
  type Column,
  type ColumnKind,
} from '@/lib/board-columns';
import { BookIcon, PlusIcon, CalendarIcon } from '@/components/icons';
import { ActionLink } from '@/components/action-link';
import { Handle } from '@/components/handle';

export function Board() {
  const session = useSession();
  const [index, setIndex] = useState<QuestIndex | null>(null);
  const [myQuests, setMyQuests] = useState<UserQuest[] | null>(null);
  const [myApplicationQuestUris, setMyApplicationQuestUris] = useState<Set<string> | null>(null);
  const [columns, setColumns] = useState<Column[]>(() => loadColumns());
  const [err, setErr] = useState<string | null>(null);

  // 公開 index
  useEffect(() => {
    let cancelled = false;
    fetchQuestIndex()
      .then((idx) => { if (!cancelled) setIndex(idx); })
      .catch((e) => { if (!cancelled) setErr(String((e as Error)?.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  // 自分の発注 + 応募
  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    let cancelled = false;
    listIssuedQuests(agent, did)
      .then((qs) => { if (!cancelled) setMyQuests(qs); })
      .catch((e) => { if (!cancelled) console.warn('[board] listIssuedQuests', e); });
    listMyApplications(agent, did)
      .then((apps) => {
        if (!cancelled) setMyApplicationQuestUris(new Set(apps.map(a => a.questUri)));
      })
      .catch((e) => { if (!cancelled) console.warn('[board] listMyApplications', e); });
    return () => { cancelled = true; };
  }, [session.status, session.agent, session.did]);

  function persistColumns(next: Column[]) {
    setColumns(next);
    saveColumns(next);
  }

  function addColumn(kind: ColumnKind, param?: string) {
    persistColumns([...columns, makeColumn(kind, param)]);
  }
  function removeColumn(id: string) {
    persistColumns(columns.filter(c => c.id !== id));
  }
  function reset() {
    setColumns(resetColumns());
  }

  return (
    <div data-board-wide="1" className="board-wide-wrap">
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

      <ColumnControls onAdd={addColumn} onReset={reset} />

      {err && <p style={{ color: 'var(--color-danger)' }}>取得に失敗: {err}</p>}

      <div className="board-columns">
        {columns.map((col) => (
          <ColumnView
            key={col.id}
            column={col}
            index={index}
            myQuests={myQuests}
            myApplicationQuestUris={myApplicationQuestUris}
            sessionDid={session.did ?? null}
            onRemove={() => removeColumn(col.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ColumnControls({ onAdd, onReset }: { onAdd: (kind: ColumnKind, param?: string) => void; onReset: () => void }) {
  const [picker, setPicker] = useState<null | 'tag' | 'job' | 'issuer'>(null);
  const [val, setVal] = useState('');

  function commitPicker(kind: 'tag' | 'job' | 'issuer') {
    const v = val.trim();
    if (!v) { setPicker(null); return; }
    onAdd(kind, v);
    setVal('');
    setPicker(null);
  }

  return (
    <div className="dq-window compact" style={{ marginBottom: '0.8em' }}>
      <div style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>カラムを追加</div>
      <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap' }}>
        <SmallBtn onClick={() => onAdd('open')}>＋ 募集中</SmallBtn>
        <SmallBtn onClick={() => onAdd('mine')}>＋ 自分が出した</SmallBtn>
        <SmallBtn onClick={() => onAdd('applied')}>＋ 自分が応募</SmallBtn>
        <SmallBtn onClick={() => setPicker('tag')}>＋ タグ別</SmallBtn>
        <SmallBtn onClick={() => setPicker('job')}>＋ ジョブ別</SmallBtn>
        <SmallBtn onClick={() => setPicker('issuer')}>＋ 発行者別 (DID)</SmallBtn>
        <SmallBtn onClick={onReset}>初期化</SmallBtn>
      </div>
      {picker === 'tag' && (
        <div style={{ marginTop: '0.4em', display: 'flex', gap: '0.3em' }}>
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="タグ名 (例: illust)" style={{ flex: 1, fontSize: '0.85em' }} />
          <SmallBtn onClick={() => commitPicker('tag')}>追加</SmallBtn>
        </div>
      )}
      {picker === 'job' && (
        <div style={{ marginTop: '0.4em', display: 'flex', gap: '0.3em' }}>
          <select value={val} onChange={(e) => setVal(e.target.value)} style={{ flex: 1, fontSize: '0.85em' }}>
            <option value="">選んでください</option>
            {JOB_OPTIONS.map((j) => (
              <option key={j} value={j}>{jobDisplayName(j, 'default')}</option>
            ))}
          </select>
          <SmallBtn onClick={() => commitPicker('job')}>追加</SmallBtn>
        </div>
      )}
      {picker === 'issuer' && (
        <div style={{ marginTop: '0.4em', display: 'flex', gap: '0.3em' }}>
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="発行者 DID (did:plc:...)" style={{ flex: 1, fontSize: '0.85em' }} />
          <SmallBtn onClick={() => commitPicker('issuer')}>追加</SmallBtn>
        </div>
      )}
    </div>
  );
}

function SmallBtn(props: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={props.onClick} style={{ padding: '0.2em 0.6em', fontSize: '0.78em' }}>
      {props.children}
    </button>
  );
}

interface ColumnViewProps {
  column: Column;
  index: QuestIndex | null;
  myQuests: UserQuest[] | null;
  myApplicationQuestUris: Set<string> | null;
  sessionDid: string | null;
  onRemove: () => void;
}

function ColumnView({ column, index, myQuests, myApplicationQuestUris, sessionDid, onRemove }: ColumnViewProps) {
  const items = useMemo(() => filterForColumn(column, index, myQuests, myApplicationQuestUris, sessionDid), [column, index, myQuests, myApplicationQuestUris, sessionDid]);
  return (
    <section className="board-column">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4em' }}>
        <div style={{ fontSize: '0.9em', fontWeight: 700 }}>
          {defaultTitleFor(column)}
          {items != null && <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: '0.4em' }}>({items.length})</span>}
        </div>
        <SmallBtn onClick={onRemove}>×</SmallBtn>
      </header>
      {items == null ? (
        <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>読み込み中...</p>
      ) : items.length === 0 ? (
        <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>なし</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((q) => (
            <li key={q.uri}>
              <QuestCard summary={q} expired={isExpiredSummary(q)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function filterForColumn(
  c: Column,
  index: QuestIndex | null,
  myQuests: UserQuest[] | null,
  myApplicationQuestUris: Set<string> | null,
  sessionDid: string | null,
): QuestIndexSummary[] | null {
  if (c.kind === 'open') {
    if (!index) return null;
    return index.quests.filter(q => q.status === 'open');
  }
  if (c.kind === 'mine') {
    if (!myQuests) return null;
    return myQuests.map(toSummary);
  }
  if (c.kind === 'applied') {
    if (!index || !myApplicationQuestUris) return null;
    return index.quests.filter(q => myApplicationQuestUris.has(q.uri));
  }
  if (c.kind === 'tag') {
    if (!index || !c.param) return null;
    const target = c.param.replace(/^#/, '').toLowerCase();
    return index.quests.filter(q =>
      q.status === 'open' &&
      q.tags.some(t => t.replace(/^#/, '').toLowerCase() === target),
    );
  }
  if (c.kind === 'job') {
    // questIndex には targetJob を載せていないため、発注者 PDS の値が必要。
    // MVP では index にない情報なので、自分が出したクエストからのみ filter する。
    // (Phase 3 後半で questIndex に targetJob を追加する想定。設計書参照)
    void sessionDid; // 将来 issuer/me filter で使う
    if (!myQuests) return null;
    return myQuests
      .filter(q => q.status === 'open' && q.targetJob === c.param)
      .map(toSummary);
  }
  if (c.kind === 'issuer') {
    if (!index || !c.param) return null;
    return index.quests.filter(q => q.status === 'open' && q.did === c.param);
  }
  return [];
}

function toSummary(q: UserQuest): QuestIndexSummary {
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

function isExpiredSummary(s: QuestIndexSummary): boolean {
  if (s.status !== 'open') return false;
  if (!s.deadline) return false;
  return new Date(s.deadline) < new Date();
}

function QuestCard({ summary, expired }: { summary: QuestIndexSummary; expired?: boolean }) {
  return (
    <Link to={`/board/${encodeURIComponent(summary.uri)}`} style={{ textDecoration: 'none' }}>
      <div className="dq-window compact" style={{ borderColor: expired ? 'var(--color-muted)' : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5em' }}>
          <div style={{ fontWeight: 700, fontSize: '0.92em', color: 'var(--color-fg)' }}>{summary.title}</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78em', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
            <Handle did={summary.did} suffix="P" /> {summary.rewardPoints.toLocaleString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', fontSize: '0.72em', color: 'var(--color-muted)', marginTop: '0.3em' }}>
          {summary.tags.slice(0, 3).map(t => <span key={t}>#{t.replace(/^#/, '')}</span>)}
          <span style={{ marginLeft: 'auto' }}>
            {expired ? '期限切れ' : summary.deadline ? `〆 ${formatDate(summary.deadline)}` : ''}
            {summary.status !== 'open' && <span style={{ marginLeft: '0.6em' }}>{labelOf(summary.status)}</span>}
          </span>
        </div>
      </div>
    </Link>
  );
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
