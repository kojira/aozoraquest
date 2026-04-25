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
import { Search } from '@/routes/search';
import { Settings } from '@/routes/settings';
import { Spirit } from '@/routes/spirit';
import { Onboarding } from '@/routes/onboarding';
import { OAuthCallback } from '@/routes/oauth-callback';
import { Tos } from '@/routes/tos';
import { Privacy } from '@/routes/privacy';
import { LlmTraceView } from '@/routes/llm-trace';
import { AppShell } from '@/components/app-shell';
import { SessionProvider } from '@/components/session-provider';
import { ConfigProvider } from '@/components/config-provider';
import { ComposeProvider } from '@/components/compose-modal';
import '@/styles.css';

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
      { path: 'search', element: <Search /> },
      { path: 'settings', element: <Settings /> },
      { path: 'spirit', element: <Spirit /> },
      { path: 'onboarding', element: <Onboarding /> },
      { path: 'oauth/callback', element: <OAuthCallback /> },
      { path: 'tos', element: <Tos /> },
      { path: 'privacy', element: <Privacy /> },
      { path: 'llm-trace', element: <LlmTraceView /> },
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
