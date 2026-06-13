/**
 * AppColumn の kind 別に中身を出し分ける dispatcher (docs/16-multicolumn.md)。
 *
 *  - PR 2: home / bar
 *  - PR 3: notifications / search / profile
 *  - PR 4: board (本 PR で全 kind 実装完了)
 */
import type { AppColumn } from '@/lib/app-columns';
import { HomeColumn } from './home-column';
import { BarColumn } from './bar-column';
import { BoardColumn } from './board-column';
import { NotificationsFeed } from '@/routes/notifications';
import { SearchPanel } from '@/routes/search';
import { ProfileView } from '@/routes/profile';

export function ColumnContent({
  column,
  onPatch,
}: {
  column: AppColumn;
  /** カラムの部分更新 (検索カラムの param 追従などに使う)。
   *  workspace 外 (将来 single 表示等) では undefined。 */
  onPatch?: ((patch: Partial<AppColumn>) => void) | undefined;
}) {
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
        // key は column.id のみ (param を含めると検索のたび remount して
        // 結果がチラつく)。カラム内の再検索は onSearch → onPatch で
        // column.param に書き戻し、ヘッダータイトルが追従する (issue #35)
        <SearchPanel
          key={column.id}
          {...(column.param !== undefined ? { initialQuery: column.param } : {})}
          {...(column.mode !== undefined ? { initialMode: column.mode } : {})}
          {...(onPatch
            ? { onSearch: (q: string, mode: 'posts' | 'users') => onPatch({ param: q, mode } as Partial<AppColumn>) }
            : {})}
        />
      );
    case 'profile':
      return column.param ? (
        // profile はカラム内で actor を変える UI がないため、外部編集 =
        // remount でよい (key に param を含める)
        <ProfileView key={`${column.id}:${column.param}`} actor={column.param} />
      ) : (
        <MissingParam label="プロフィール" hint="表示するユーザーの指定がありません。「＋ カラムを追加」からハンドルを指定して追加し直してください。" />
      );
    case 'board':
      return <BoardColumn inner={column.inner} />;
  }
}

function MissingParam({ label, hint }: { label: string; hint: string }) {
  return (
    <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', lineHeight: 1.6 }}>
      {label}: {hint}
    </p>
  );
}
