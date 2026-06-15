/**
 * 依頼クエスト掲示板 (docs/15-user-quest.md §UI 設計 B + E)。
 *
 * フル表示ページ: inner カラム (open / mine / applied / tag / job / issuer)
 * を追加・削除しながら横並びで見る。表示部品とデータ取得は
 * components/column-content/board-shared.tsx に共用化されており、
 * workspace の board カラム (タブ切替式) と同じものを使う。
 */
import { useMemo, useState } from 'react';
import { jobDisplayName } from '@aozoraquest/core';
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
import {
  useBoardData,
  filterForBoard,
  isExpiredSummary,
  emptyMessageForBoard,
  QuestCard,
  ApprovalPendingBanner,
} from '@/components/column-content/board-shared';
import { BookIcon, PlusIcon, CalendarIcon } from '@/components/icons';
import { ActionLink } from '@/components/action-link';
import { useSession } from '@/lib/session';

export function Board() {
  const session = useSession();
  const signedIn = session.status === 'signed-in';
  const [columns, setColumns] = useState<Column[]>(() => loadColumns());
  const { index, myQuests, myApplicationQuestUris, pendingApproval, err } = useBoardData();
  const pendingUris = useMemo(() => new Set(pendingApproval.map((q) => q.uri)), [pendingApproval]);

  // 未ログイン時は「自分が出した / 応募」など自分前提のカラムを描画しない
  // (保存設定は壊さず描画だけ除外。ログインで復活する)。
  const visibleColumns = signedIn
    ? columns
    : columns.filter((c) => c.kind !== 'mine' && c.kind !== 'applied');

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
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5em', flexWrap: 'wrap', gap: '0.5em' }}>
        <h2 style={{ margin: 0, fontSize: '1.1em' }}>クエスト掲示板</h2>
        {session.status === 'signed-in' && (
          <span style={{ display: 'inline-flex', gap: '0.5em', flexWrap: 'wrap' }}>
            <ActionLink to="/me/portfolio" icon={<BookIcon size={20} />}>履歴</ActionLink>
            <ActionLink to="/board/new" icon={<PlusIcon size={20} />}>クエストを出す</ActionLink>
          </span>
        )}
      </header>

      <p style={{ margin: '0 0 0.6em', fontSize: '0.85em', color: 'var(--color-muted)', lineHeight: 1.5 }}>
        お互いの「<strong>名前のポイント</strong>」(例: kojira.io ポイント) を発行しあって、やってほしいことを頼み合う掲示板です。
        応募は誰でも、完了の判定は発注者が行います。報酬は自分が発行するので元手は要りません。
      </p>

      <p style={{ margin: '0 0 0.8em' }}>
        <ActionLink to="/quests" icon={<CalendarIcon size={18} />} variant="inline">
          日次クエスト (個人用) はこちら
        </ActionLink>
      </p>

      {/* カラム管理はログイン時のみ (未ログインは閲覧専用) */}
      {signedIn && <ColumnControls onAdd={addColumn} onReset={reset} />}

      {err && <p style={{ color: 'var(--color-danger)' }}>取得に失敗: {err}</p>}

      {/* 承認待ち (完了報告が届いた自分の依頼) を最上部で promote。各クエストへ直リンク。 */}
      <ApprovalPendingBanner pending={pendingApproval} />

      <div className="board-columns">
        {visibleColumns.map((col) => (
          <BoardInnerColumnView
            key={col.id}
            column={col}
            indexData={{ index, myQuests, myApplicationQuestUris }}
            pendingUris={pendingUris}
            selfDid={session.did ?? null}
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
        <SmallBtn onClick={() => onAdd('assigned')}>＋ 受託中</SmallBtn>
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

interface BoardInnerColumnViewProps {
  column: Column;
  indexData: {
    index: ReturnType<typeof useBoardData>['index'];
    myQuests: ReturnType<typeof useBoardData>['myQuests'];
    myApplicationQuestUris: ReturnType<typeof useBoardData>['myApplicationQuestUris'];
  };
  pendingUris: Set<string>;
  selfDid: string | null;
  onRemove: () => void;
}

function BoardInnerColumnView({ column, indexData, pendingUris, selfDid, onRemove }: BoardInnerColumnViewProps) {
  const { index, myQuests, myApplicationQuestUris } = indexData;
  const items = useMemo(
    () => filterForBoard(column, index, myQuests, myApplicationQuestUris, selfDid),
    [column, index, myQuests, myApplicationQuestUris, selfDid],
  );
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
        <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>{emptyMessageForBoard(column)}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((q) => (
            <li key={q.uri}>
              <QuestCard summary={q} expired={isExpiredSummary(q)} needsApproval={pendingUris.has(q.uri)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
