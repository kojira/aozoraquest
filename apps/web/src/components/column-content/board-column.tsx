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
import { DISCOVERY_TAG } from '@/lib/quest-api';
import {
  useBoardData,
  filterForBoard,
  isExpiredSummary,
  emptyMessageForBoard,
  boardFilterTitle,
  QuestCard,
  ApprovalPendingBanner,
  ReportPendingBanner,
  type BoardFilter,
} from './board-shared';

const DEFAULT_INNER: BoardInner[] = [{ kind: 'open' }, { kind: 'assigned' }, { kind: 'mine' }, { kind: 'applied' }];

/** タブ表示用ラベル。issuer は DID 全表示だと長く区別もできないため
 *  末尾を省略して識別子の頭を見せる。 */
function boardTabLabel(t: BoardFilter): string {
  if (t.kind === 'issuer' && t.param) {
    const short = t.param.replace(/^did:plc:/, '').slice(0, 6);
    return `発行者: ${short}…`;
  }
  return boardFilterTitle(t);
}

export function BoardColumn({ inner }: { inner?: BoardInner[] | undefined }) {
  const tabs: BoardFilter[] = (inner && inner.length > 0) ? inner : DEFAULT_INNER;
  const [tabIndex, setTabIndex] = useState(0);
  // tabs が縮んだとき (inner 編集の反映等) に範囲外参照と highlight ズレを
  // 両方防ぐため、clamp した index を表示にも使う
  const activeIndex = Math.min(tabIndex, tabs.length - 1);
  const active = tabs[activeIndex]!;

  const { index, myQuests, myApplicationQuestUris, pendingApproval, assigneeStates, reportPending, err, sessionDid } = useBoardData();
  const items = useMemo(
    () => filterForBoard(active, index, myQuests, myApplicationQuestUris, sessionDid),
    [active, index, myQuests, myApplicationQuestUris, sessionDid],
  );
  const pendingUris = useMemo(() => new Set(pendingApproval.map((q) => q.uri)), [pendingApproval]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5em', marginBottom: '0.4em' }}>
        <Link to="/board" style={{ fontSize: '0.78em' }}>掲示板をフル表示 →</Link>
        <Link to="/board/new" style={{ fontSize: '0.78em' }}>＋ クエストを出す</Link>
      </div>

      {tabs.length > 1 && (
        // dq-tabs (flex:1 等分) だと 5-6 タブで日本語が縦折返しして潰れる
        // ため、横スクロールする chip 行にする (レビュー指摘 ★★★)
        <div className="board-column-tabs">
          {tabs.map((t, i) => (
            <button
              key={`${t.kind}:${t.param ?? ''}:${i}`}
              onClick={() => setTabIndex(i)}
              className={`dq-tab${i === activeIndex ? ' active' : ''}`}
            >
              {boardTabLabel(t)}
            </button>
          ))}
        </div>
      )}

      {err && <p style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>取得に失敗: {err}</p>}

      {/* どのタブを見ていても「自分の番」に気づけるよう、リスト上部に常設
          (発注者=承認待ち / 受託者=報告する番)。 */}
      <ApprovalPendingBanner pending={pendingApproval} />
      <ReportPendingBanner pending={reportPending} />

      {items == null ? (
        <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>読み込み中...</p>
      ) : items.length === 0 ? (
        <BoardEmpty filter={active} />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((q) => {
            const aState = active.kind === 'assigned' ? assigneeStates.get(q.uri) : undefined;
            return (
              <li key={q.uri}>
                <QuestCard
                  summary={q}
                  expired={isExpiredSummary(q)}
                  needsApproval={pendingUris.has(q.uri)}
                  {...(aState ? { assigneeState: aState } : {})}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 空表示。クエストの発見はオプトイン (BAR ブルスコ参加) で広がるので、
 *  open / mine が空のときはオプトイン誘導を出す。
 *  (「クエストを出す」リンクはカラムヘッダに常設なので空表示では重複させない) */
function BoardEmpty({ filter }: { filter: BoardFilter }) {
  const showGuide = filter.kind === 'open' || filter.kind === 'mine';
  return (
    <div style={{ fontSize: '0.8em', color: 'var(--color-muted)', lineHeight: 1.6 }}>
      <p style={{ margin: 0 }}>{emptyMessageForBoard(filter)}</p>
      {showGuide && (
        <p style={{ marginTop: '0.6em' }}>
          自分のクエストや投稿を見つけてもらうには{' '}
          <Link to="/settings">BAR ブルスコに参加 (オプトイン)</Link>
          。<code>#{DISCOVERY_TAG}</code> を 1 件投稿して掲示板の発見元に載ります。
        </p>
      )}
    </div>
  );
}
