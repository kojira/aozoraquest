/**
 * AppColumn の kind 別に中身を出し分ける dispatcher (docs/16-multicolumn.md)。
 *
 * 段階導入の途中 (flag なし方針) なので、未実装の kind は従来ページへの
 * リンク付きプレースホルダを出す:
 *  - PR 2: home / bar
 *  - PR 3: notifications / search / profile (本 PR)
 *  - PR 4: board
 */
import { Link } from 'react-router-dom';
import type { AppColumn } from '@/lib/app-columns';
import { HomeColumn } from './home-column';
import { BarColumn } from './bar-column';
import { NotificationsFeed } from '@/routes/notifications';
import { SearchPanel } from '@/routes/search';
import { ProfileView } from '@/routes/profile';

export function ColumnContent({ column }: { column: AppColumn }) {
  switch (column.kind) {
    case 'home':
      return <HomeColumn />;
    case 'bar':
      return <BarColumn />;
    case 'notifications':
      // markSeen は渡さない (= カラム表示では既読化しない。通知ページを
      // 開いたときだけ既読化する。可視判定ベースは PR 5)
      return <NotificationsFeed />;
    case 'search':
      return (
        // key に param/mode を含め、カラム編集 (PR 4) で param が変わったら
        // remount して initial 値を反映する (useState 初期値のみのため)
        <SearchPanel
          key={`${column.id}:${column.param ?? ''}:${column.mode ?? ''}`}
          {...(column.param !== undefined ? { initialQuery: column.param } : {})}
          {...(column.mode !== undefined ? { initialMode: column.mode } : {})}
        />
      );
    case 'profile':
      return column.param ? (
        <ProfileView key={`${column.id}:${column.param}`} actor={column.param} />
      ) : (
        <MissingParam label="プロフィール" hint="表示するユーザーの指定がありません。今後のアップデートでカラム追加時にハンドルを指定できるようになります。" />
      );
    case 'board':
      return <PendingColumn label="クエスト掲示板" to="/board" />;
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

function MissingParam({ label, hint }: { label: string; hint: string }) {
  return (
    <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', lineHeight: 1.6 }}>
      {label}: {hint}
    </p>
  );
}
