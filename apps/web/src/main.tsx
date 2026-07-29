import { StrictMode, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Workspace } from '@/components/workspace';
import { installOAuthDebug } from '@/lib/oauth-debug';

// dev のみ: 固まったらコンソールで __aozoraDumpOAuth() を叩ける (session 復元前に登録)。
installOAuthDebug();
// 初回に必要な shell + workspace(ホーム) だけ eager。それ以外のルートは lazy 分割して
// 初期バンドルから外す (初回表示の JS を軽くする)。named export を default に写す。
const Profile = lazy(() => import('@/routes/profile').then(m => ({ default: m.Profile })));
const MyProfile = lazy(() => import('@/routes/me').then(m => ({ default: m.MyProfile })));
const Friends = lazy(() => import('@/routes/friends').then(m => ({ default: m.Friends })));
const Card = lazy(() => import('@/routes/card').then(m => ({ default: m.Card })));
const PostDetail = lazy(() => import('@/routes/post-detail').then(m => ({ default: m.PostDetail })));
const Notifications = lazy(() => import('@/routes/notifications').then(m => ({ default: m.Notifications })));
const Quests = lazy(() => import('@/routes/quests').then(m => ({ default: m.Quests })));
const Search = lazy(() => import('@/routes/search').then(m => ({ default: m.Search })));
const Settings = lazy(() => import('@/routes/settings').then(m => ({ default: m.Settings })));
const Spirit = lazy(() => import('@/routes/spirit').then(m => ({ default: m.Spirit })));
const AdminDashboard = lazy(() => import('@/routes/admin-dashboard').then(m => ({ default: m.AdminDashboard })));
const AdminMap = lazy(() => import('@/routes/admin-map').then(m => ({ default: m.AdminMap })));
const AdminMonsters = lazy(() => import('@/routes/admin-monsters').then(m => ({ default: m.AdminMonsters })));
const AdminItems = lazy(() => import('@/routes/admin-items').then(m => ({ default: m.AdminItems })));
const AdminShops = lazy(() => import('@/routes/admin-shops').then(m => ({ default: m.AdminShops })));
const AdminNpcs = lazy(() => import('@/routes/admin-npcs').then(m => ({ default: m.AdminNpcs })));
const World = lazy(() => import('@/routes/world').then(m => ({ default: m.World })));
const Onboarding = lazy(() => import('@/routes/onboarding').then(m => ({ default: m.Onboarding })));
const OAuthCallback = lazy(() => import('@/routes/oauth-callback').then(m => ({ default: m.OAuthCallback })));
const Tos = lazy(() => import('@/routes/tos').then(m => ({ default: m.Tos })));
const Privacy = lazy(() => import('@/routes/privacy').then(m => ({ default: m.Privacy })));
const Board = lazy(() => import('@/routes/board').then(m => ({ default: m.Board })));
const BoardNew = lazy(() => import('@/routes/board-new').then(m => ({ default: m.BoardNew })));
const BoardDetail = lazy(() => import('@/routes/board-detail').then(m => ({ default: m.BoardDetail })));
const BoardDetailLegacyRedirect = lazy(() => import('@/routes/board-detail').then(m => ({ default: m.BoardDetailLegacyRedirect })));
const Portfolio = lazy(() => import('@/routes/portfolio').then(m => ({ default: m.Portfolio })));
const PublicPortfolio = lazy(() => import('@/routes/portfolio').then(m => ({ default: m.PublicPortfolio })));
const DebugCard = lazy(() => import('@/routes/debug-card').then(m => ({ default: m.DebugCard })));
const DebugRadar = lazy(() => import('@/routes/debug-radar').then(m => ({ default: m.DebugRadar })));
const DebugMe = lazy(() => import('@/routes/debug-me').then(m => ({ default: m.DebugMe })));
import { AppShell } from '@/components/app-shell';
import { SessionProvider } from '@/components/session-provider';
import { ConfigProvider } from '@/components/config-provider';
import { ComposeProvider } from '@/components/compose-modal';
import { initFontScale } from '@/lib/font-scale';
import { initTheme } from '@/lib/theme';
import { removeSplash } from '@/lib/splash';
import '@/styles.css';

initFontScale();
initTheme();

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Workspace /> },
      { path: 'profile/:handle', element: <Profile /> },
      { path: 'me', element: <MyProfile /> },
      { path: 'friends', element: <Friends /> },
      { path: 'me/card', element: <Card /> },
      { path: 'profile/:handle/post/:rkey', element: <PostDetail /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'quests', element: <Quests /> },
      { path: 'board', element: <Board /> },
      { path: 'board/new', element: <BoardNew /> },
      { path: 'board/:repo/:rkey', element: <BoardDetail /> },
      // 旧 `/board/<encodeURIComponent(at-uri)>` リンク (Bluesky に投稿済み) の救済。
      // 新規ロードで %2F が / に正規化され splat に at-uri がそのまま入るので、
      // clean form (/board/:repo/:rkey) へ redirect する。
      // 注意: 新しい board サブルートを足すときは必ずこの `board/*` より **上** に置くこと
      // (splat が全部飲み込むため。React Router は静的/名前付きルートを splat より上位に
      //  ランクするので順序自体は問題ないが、可読性のため上に書く)。
      { path: 'board/*', element: <BoardDetailLegacyRedirect /> },
      { path: 'me/portfolio', element: <Portfolio /> },
      { path: 'profile/:handle/portfolio', element: <PublicPortfolio /> },
      { path: 'search', element: <Search /> },
      { path: 'settings', element: <Settings /> },
      { path: 'spirit', element: <Spirit /> },
      // /admin は無条件登録 + コンポーネント内の表示ゲート (isAdminDid)。
      // **本番でも管理者は中身まで開ける** (2026-07-27)。書き込みを伴う操作は
      // すべて edge 側で ADMIN_DIDS を検証しているので、表示ゲートに認可を負わせていない
      // (isAdminDid は公開 env との文字列一致なので詐称できる = 守りにはならない)。
      { path: 'admin', element: <AdminDashboard /> },
      // マップエディタは別画面 (地図が広く、他の管理ツールと同居すると双方が使いにくい)
      { path: 'admin/map', element: <AdminMap /> },
      { path: 'admin/monsters', element: <AdminMonsters /> },
      { path: 'admin/items', element: <AdminItems /> },
      { path: 'admin/shops', element: <AdminShops /> },
      { path: 'admin/npcs', element: <AdminNpcs /> },
      { path: 'world', element: <World /> },
      { path: 'onboarding', element: <Onboarding /> },
      { path: 'oauth/callback', element: <OAuthCallback /> },
      { path: 'tos', element: <Tos /> },
      { path: 'privacy', element: <Privacy /> },
      // 任意 URL でカード偽装 → スクショされる悪用を避けるため、本番ビルドでは
      // /debug/* route 自体を登録しない (vite が条件式を静的解釈して
      // dead-code elimination)。
      //   - ローカル dev (pnpm dev): import.meta.env.DEV = true で含まれる
      //   - CI の e2e (card-share-size.spec.ts): VITE_INCLUDE_DEBUG=1 を build 時に
      //     渡すことで preview ビルドにも含める
      //   - 本番 Cloudflare Workers Builds: 両方 false で除外される
      // ヒーロー画像生成 (scripts/capture-hero-card.ts) は dev サーバー前提。
      ...((import.meta.env.DEV || import.meta.env.VITE_INCLUDE_DEBUG === '1') ? [
        { path: 'debug/card', element: <DebugCard /> },
        { path: 'debug/radar', element: <DebugRadar /> },
        { path: 'debug/me', element: <DebugMe /> },
      ] : []),
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider>
      <SessionProvider>
        <ComposeProvider>
          <RouterProvider router={router} />
        </ComposeProvider>
      </SessionProvider>
    </ConfigProvider>
  </StrictMode>,
);

// スプラッシュ (index.html) は通常 AppShell が session 復元完了時に除去する
// (JS パース + 復元の間ずっと 1 枚出続け、「準備しています…」のちらつきを避ける)。
// ここはハング保険: 復元が異常に長い/失敗しても最大 12s でスプラッシュを剥がす。
setTimeout(removeSplash, 12000);
