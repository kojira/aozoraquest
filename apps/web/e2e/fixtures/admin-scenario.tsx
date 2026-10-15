// Only the PDS transport is isolated; actual editors, gzip codecs and validators run unchanged.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { SessionContext } from '../../src/lib/session';
import { AdminScenario } from '../../src/routes/admin-scenario';
import { AppShell } from '../../src/components/app-shell';
import '../../src/styles.css';

async function call(op: string, params: unknown) {
  const response = await fetch('/scenario-fixture-pds', { method: 'POST', body: JSON.stringify({ op, params }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { error: data.error });
  return { data };
}
const agent = {
  assertDid: 'did:plc:villageadmin',
  getProfile: async () => ({ data: { displayName: '管理者', handle: 'village.invalid' } }),
  com: { atproto: { repo: {
    getRecord: (p: unknown) => call('get', p), putRecord: (p: unknown) => call('put', p), listRecords: (p: unknown) => call('list', p),
  } } },
} as unknown as Agent;
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/admin/scenario']}>
    <SessionContext.Provider value={{ status: 'signed-in', did: agent.assertDid, agent }}>
      <Routes><Route element={<AppShell />}>
        <Route path="/admin/scenario" element={<AdminScenario />} />
      </Route></Routes>
    </SessionContext.Provider>
  </MemoryRouter>,
);
