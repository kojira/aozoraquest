import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Home } from '@/routes/home';
import { Profile } from '@/routes/profile';
import { MyProfile } from '@/routes/me';
import { Compose } from '@/routes/compose';
import { PostDetail } from '@/routes/post-detail';
import { Notifications } from '@/routes/notifications';
import { Search } from '@/routes/search';
import { Settings } from '@/routes/settings';
import { Spirit } from '@/routes/spirit';
import { Onboarding } from '@/routes/onboarding';
import { OAuthCallback } from '@/routes/oauth-callback';
import { Tos } from '@/routes/tos';
import { Privacy } from '@/routes/privacy';
import { AppShell } from '@/components/app-shell';
import { SessionProvider } from '@/components/session-provider';
import { ConfigProvider } from '@/components/config-provider';
import '@/styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'profile/:handle', element: <Profile /> },
      { path: 'me', element: <MyProfile /> },
      { path: 'compose', element: <Compose /> },
      { path: 'post/:uri', element: <PostDetail /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'search', element: <Search /> },
      { path: 'settings', element: <Settings /> },
      { path: 'spirit', element: <Spirit /> },
      { path: 'onboarding', element: <Onboarding /> },
      { path: 'oauth/callback', element: <OAuthCallback /> },
      { path: 'tos', element: <Tos /> },
      { path: 'privacy', element: <Privacy /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider>
      <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
    </ConfigProvider>
  </StrictMode>,
);
