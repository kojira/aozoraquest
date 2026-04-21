import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AdminShell } from '@/components/admin-shell';
import { AdminSessionProvider } from '@/components/admin-session-provider';
import { Dashboard } from '@/routes/dashboard';
import { Flags } from '@/routes/flags';
import { Prompts } from '@/routes/prompts';
import { Maintenance } from '@/routes/maintenance';
import { Bans } from '@/routes/bans';
import { DirectoryRoute } from '@/routes/directory';
import { History } from '@/routes/history';
import { OAuthCallback } from '@/routes/oauth-callback';
import '@/styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AdminShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'flags', element: <Flags /> },
      { path: 'prompts', element: <Prompts /> },
      { path: 'maintenance', element: <Maintenance /> },
      { path: 'bans', element: <Bans /> },
      { path: 'directory', element: <DirectoryRoute /> },
      { path: 'history', element: <History /> },
      { path: 'oauth/callback', element: <OAuthCallback /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminSessionProvider>
      <RouterProvider router={router} />
    </AdminSessionProvider>
  </StrictMode>,
);
