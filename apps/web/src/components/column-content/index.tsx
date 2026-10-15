/**
 * AppColumn の kind 別に中身を出し分ける dispatcher (docs/16-multicolumn.md)。
 *
 *  - PR 2: home / bar
 *  - PR 3: notifications / search / profile
 *  - PR 4: board (本 PR で全 kind 実装完了)
 */
import { lazy, Suspense } from 'react';
import type { AppColumn } from '@/lib/app-columns';
import { HomeColumn } from './home-column';
import { BarColumn } from './bar-column';
// 初回表示はホームが主役。非ホームカラム (board/通知/検索/profile) は lazy 分割して
// 初期チャンクから外し、ホームの feed 描画がこれらのコードを待たないようにする。
// (ルート側 main.tsx と同じモジュールを指すので chunk は共有 = 二重取得しない)
const BoardColumn = lazy(() => import('./board-column').then((m) => ({ default: m.BoardColumn })));
const NotificationsFeed = lazy(() => import('@/routes/notifications').then((m) => ({ default: m.NotificationsFeed })));
const SearchPanel = lazy(() => import('@/routes/search').then((m) => ({ default: m.SearchPanel })));
const ProfileView = lazy(() => import('@/routes/profile').then((m) => ({ default: m.ProfileView })));

const COL_FALLBACK = <div style={{ padding: '1em', fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中…</div>;

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
      return <Suspense fallback={COL_FALLBACK}><NotificationsFeed /></Suspense>;
    case 'search':
      return (
        // key は column.id のみ (param を含めると検索のたび remount して
        // 結果がチラつく)。カラム内の再検索は onSearch → onPatch で
        // column.param に書き戻し、ヘッダータイトルが追従する (issue #35)
        <Suspense fallback={COL_FALLBACK}>
          <SearchPanel
            key={column.id}
            {...(column.param !== undefined ? { initialQuery: column.param } : {})}
            {...(column.mode !== undefined ? { initialMode: column.mode } : {})}
            {...(onPatch
              ? { onSearch: (q: string, mode: 'posts' | 'users') => onPatch({ param: q, mode } as Partial<AppColumn>) }
              : {})}
          />
        </Suspense>
      );
    case 'profile':
      return column.param ? (
        // profile はカラム内で actor を変える UI がないため、外部編集 =
        // remount でよい (key に param を含める)
        <Suspense fallback={COL_FALLBACK}>
          <ProfileView key={`${column.id}:${column.param}`} actor={column.param} />
        </Suspense>
      ) : (
        <MissingParam label="プロフィール" hint="表示するユーザーの指定がありません。「＋ カラムを追加」からハンドルを指定して追加し直してください。" />
      );
    case 'board':
      return <Suspense fallback={COL_FALLBACK}><BoardColumn inner={column.inner} /></Suspense>;
  }
}

function MissingParam({ label, hint }: { label: string; hint: string }) {
  return (
    <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', lineHeight: 1.6 }}>
      {label}: {hint}
    </p>
  );
}
