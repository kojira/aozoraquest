/**
 * board カラム: 依頼クエスト掲示板 (docs/16-multicolumn.md)。
 *
 * 340px のカラム内に board の inner マルチカラム (320px 横並び) は
 * 物理的に入らないため、カラム内では **inner をタブ切替** で出す。
 * フル機能 (inner の追加・削除を含む横並び表示) は従来ページ /board に
 * リンクで誘導する。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BoardInner } from '@/lib/app-columns';
import {
  useBoardData,
  filterForBoard,
  isExpiredSummary,
  emptyMessageForBoard,
  boardFilterTitle,
  QuestCard,
  type BoardFilter,
} from './board-shared';

const DEFAULT_INNER: BoardInner[] = [{ kind: 'open' }, { kind: 'mine' }];

export function BoardColumn({ inner }: { inner?: BoardInner[] | undefined }) {
  const tabs: BoardFilter[] = (inner && inner.length > 0) ? inner : DEFAULT_INNER;
  const [tabIndex, setTabIndex] = useState(0);
  const active = tabs[Math.min(tabIndex, tabs.length - 1)]!;

  const { index, myQuests, myApplicationQuestUris, err } = useBoardData();
  const items = useMemo(
    () => filterForBoard(active, index, myQuests, myApplicationQuestUris),
    [active, index, myQuests, myApplicationQuestUris],
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5em', marginBottom: '0.4em' }}>
        <Link to="/board" style={{ fontSize: '0.78em' }}>掲示板をフル表示 →</Link>
        <Link to="/board/new" style={{ fontSize: '0.78em' }}>＋ クエストを出す</Link>
      </div>

      {tabs.length > 1 && (
        <div className="dq-tabs" style={{ margin: '0 0 0.5em' }}>
          {tabs.map((t, i) => (
            <button
              key={`${t.kind}:${t.param ?? ''}`}
              onClick={() => setTabIndex(i)}
              className={`dq-tab${i === tabIndex ? ' active' : ''}`}
              style={{ fontSize: '0.8em', padding: '0.35em 0.3em' }}
            >
              {boardFilterTitle(t)}
            </button>
          ))}
        </div>
      )}

      {err && <p style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>取得に失敗: {err}</p>}

      {items == null ? (
        <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>読み込み中...</p>
      ) : items.length === 0 ? (
        <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>{emptyMessageForBoard(active)}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((q) => (
            <li key={q.uri}>
              <QuestCard summary={q} expired={isExpiredSummary(q)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
