// Isolated transport only; the actual editor, session context, renderer and save functions run unchanged.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { allNpcs } from '@aozoraquest/core';
import { SessionContext } from '../../src/lib/session';
import { AdminNpcs } from '../../src/routes/admin-npcs';
import { AppShell } from '../../src/components/app-shell';
import { World } from '../../src/routes/world';
import '../../src/styles.css';

async function call(op: string, params: unknown) {
  const response = await fetch('/npc-fixture-pds', { method: 'POST', body: JSON.stringify({ op, params }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { error: data.error, name: data.error === 'RecordNotFound' ? 'RecordNotFoundError' : 'Error' });
  return { data };
}
const agent = {
  assertDid: 'did:plc:npcadmin',
  getProfile: async () => ({ data: { displayName: '管理者', handle: 'npc.invalid' } }),
  com: { atproto: { repo: {
    getRecord: (p: unknown) => call('get', p), putRecord: (p: unknown) => call('put', p), listRecords: (p: unknown) => call('list', p), createRecord: (p: unknown) => call('put', p),
  }, server: { getServiceAuth: async () => ({ data: { token: 'isolated-test' } }) } } },
} as unknown as Agent;
// Read-only observation for assertions: no substitute editor logic is installed here.
Object.assign(window, { npcFixture: { savedNpcs: () => allNpcs() } });
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[location.search.includes('game') ? '/world' : '/admin/npcs']}><SessionContext.Provider value={{ status: 'signed-in', did: agent.assertDid, agent }}>
  <Routes><Route element={<AppShell />}><Route path="/world" element={<World />} /><Route path="/admin/npcs" element={<AdminNpcs />} /></Route></Routes>
</SessionContext.Provider></MemoryRouter>);
