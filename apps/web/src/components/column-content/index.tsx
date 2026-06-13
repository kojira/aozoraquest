/**
 * AppColumn の kind 別に中身を出し分ける dispatcher (docs/16-multicolumn.md)。
 *
 * 段階導入の途中 (flag なし方針) なので、未実装の kind は従来ページへの
 * リンク付きプレースホルダを出す:
 *  - PR 2 (本 PR): home / bar
 *  - PR 3: notifications / search / profile
 *  - PR 4: board
 */
import { Link } from 'react-router-dom';
import type { AppColumn } from '@/lib/app-columns';
import { HomeColumn } from './home-column';
import { BarColumn } from './bar-column';

export function ColumnContent({ column }: { column: AppColumn }) {
  switch (column.kind) {
    case 'home':
      return <HomeColumn />;
    case 'bar':
      return <BarColumn />;
    case 'notifications':
      return <PendingColumn label="通知" to="/notifications" />;
    case 'search':
      return <PendingColumn label="検索" to={column.param ? `/search?q=${encodeURIComponent(column.param)}` : '/search'} />;
    case 'board':
      return <PendingColumn label="クエスト掲示板" to="/board" />;
    case 'profile':
      return <PendingColumn label="プロフィール" to={column.param ? `/profile/${column.param}` : '/me'} />;
  }
}

/** カラム化が後続 PR で届く kind の仮表示。従来ページに誘導する。 */
function PendingColumn({ label, to }: { label: string; to: string }) {
  return (
    <div style={{ padding: '0.5em 0' }}>
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', lineHeight: 1.6 }}>
        {label}のカラム表示は準備中です。今はページとして開けます。
      </p>
      <Link to={to}><button style={{ marginTop: '0.4em' }}>{label}を開く</button></Link>
    </div>
  );
}
