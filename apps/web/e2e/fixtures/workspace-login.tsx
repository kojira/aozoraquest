// Test entry only: real AppShell + Workspace + OAuthCallback. Session goes loading → signed-in
// like the OAuth callback (useSessionLoader), with an offline agent (empty feeds).
import React, { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { SessionContext, type SessionState } from '../../src/lib/session';
import { AppShell } from '../../src/components/app-shell';
import { Workspace } from '../../src/components/workspace';
import { OAuthCallback } from '../../src/routes/oauth-callback';
import { ComposeProvider } from '../../src/components/compose-modal';
import '../../src/styles.css';

const notFound = async () => { throw Object.assign(new Error('RecordNotFound'), { name: 'RecordNotFoundError' }); };
const agent = {
  assertDid: 'did:plc:columnlogin', did: 'did:plc:columnlogin',
  getProfile: async () => ({ data: { handle: 'column.invalid' } }),
  getTimeline: async () => ({ data: { feed: [] } }),
  getFollows: async () => ({ data: { follows: [] } }),
  getAuthorFeed: async () => ({ data: { feed: [] } }),
  app: { bsky: { notification: {
    getUnreadCount: async () => ({ data: { count: 0 } }),
    listNotifications: async () => ({ data: { notifications: [] } }),
  } } },
  com: { atproto: { repo: { getRecord: notFound, listRecords: async () => ({ data: { records: [] } }) } } },
} as unknown as Agent;

function FixtureSession({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    const t = setTimeout(() => setState({ status: 'signed-in', did: 'did:plc:columnlogin', agent }), 300);
    return () => clearTimeout(t);
  }, []);
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

const router = createMemoryRouter([{ path: '/', element: <AppShell />, children: [
  { index: true, element: <Workspace /> },
  { path: 'oauth/callback', element: <OAuthCallback /> },
] }], { initialEntries: [new URLSearchParams(location.search).get('entry') ?? '/oauth/callback'] });

createRoot(document.getElementById('root')!).render(
  <FixtureSession><ComposeProvider><RouterProvider router={router} /></ComposeProvider></FixtureSession>,
);
