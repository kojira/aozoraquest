// Isolated PDS transport, not a substitute editor or renderer. No real uploads.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { SessionContext } from '../../src/lib/session';
import { AdminNpcs } from '../../src/routes/admin-npcs';
import { AppShell } from '../../src/components/app-shell';
import { World } from '../../src/routes/world';
import '../../src/styles.css';
async function call(op: string, params: unknown) {
  const res = await fetch('/npc-upload-pds', { method: 'POST', body: JSON.stringify({ op, params }) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error), { error: data.error, name: data.error === 'RecordNotFound' ? 'RecordNotFoundError' : 'Error' });
  return { data };
}
const params = new URLSearchParams(location.search);
const agent = {
  assertDid: params.has('viewer') ? 'did:plc:npcviewer' : params.has('secondary') ? 'did:plc:npcsecondary' : 'did:plc:npcadmin',
  getProfile: async () => ({ data: { displayName: '旅人', handle: 'npc.invalid' } }),
  uploadBlob: async (blob: Blob) => {
    const res = await fetch('/npc-upload-blob', { method: 'POST', body: blob });
    const data = await res.json(); if (!res.ok) throw new Error('upload failed'); return { data };
  },
  com: { atproto: { repo: {
    getRecord: (p: unknown) => call('get', p), putRecord: (p: unknown) => call('put', p), listRecords: (p: unknown) => call('list', p), createRecord: (p: unknown) => call('put', p),
  }, server: { getServiceAuth: async () => ({ data: { token: 'isolated-test' } }) } } },
} as unknown as Agent;
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[params.has('game') ? '/world' : '/admin/npcs']}><SessionContext.Provider value={{ status: 'signed-in', did: agent.assertDid, agent }}>
  <Routes><Route element={<AppShell />}><Route path="/world" element={<World />} /><Route path="/admin/npcs" element={<AdminNpcs />} /></Route></Routes>
</SessionContext.Provider></MemoryRouter>);
