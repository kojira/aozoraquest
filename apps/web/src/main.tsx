import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Home } from '@/routes/home';
import { Profile } from '@/routes/profile';
import { MyProfile } from '@/routes/me';
import { Friends } from '@/routes/friends';
import { Card } from '@/routes/card';
import { PostDetail } from '@/routes/post-detail';
import { Notifications } from '@/routes/notifications';
import { Quests } from '@/routes/quests';
import { Search } from '@/routes/search';
import { Settings } from '@/routes/settings';
import { Spirit } from '@/routes/spirit';
import { Onboarding } from '@/routes/onboarding';
import { OAuthCallback } from '@/routes/oauth-callback';
import { Tos } from '@/routes/tos';
import { Privacy } from '@/routes/privacy';
import { Board } from '@/routes/board';
import { BoardNew } from '@/routes/board-new';
import { BoardDetail } from '@/routes/board-detail';
import { Portfolio, PublicPortfolio } from '@/routes/portfolio';
import { DebugCard } from '@/routes/debug-card';
import { DebugRadar } from '@/routes/debug-radar';
import { DebugMe } from '@/routes/debug-me';
import { AppShell } from '@/components/app-shell';
import { SessionProvider } from '@/components/session-provider';
import { ConfigProvider } from '@/components/config-provider';
import { ComposeProvider } from '@/components/compose-modal';
import { initFontScale } from '@/lib/font-scale';
import '@/styles.css';

initFontScale();

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'profile/:handle', element: <Profile /> },
      { path: 'me', element: <MyProfile /> },
      { path: 'friends', element: <Friends /> },
      { path: 'me/card', element: <Card /> },
      { path: 'profile/:handle/post/:rkey', element: <PostDetail /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'quests', element: <Quests /> },
      { path: 'board', element: <Board /> },
      { path: 'board/new', element: <BoardNew /> },
      { path: 'board/:uri', element: <BoardDetail /> },
      { path: 'me/portfolio', element: <Portfolio /> },
      { path: 'profile/:handle/portfolio', element: <PublicPortfolio /> },
      { path: 'search', element: <Search /> },
      { path: 'settings', element: <Settings /> },
      { path: 'spirit', element: <Spirit /> },
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
