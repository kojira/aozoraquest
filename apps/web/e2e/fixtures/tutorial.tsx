// Test entry only: real World/SessionContext, with an isolated PDS identity/transport.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { SessionContext } from '../../src/lib/session';
import { World } from '../../src/routes/world';
import '../../src/styles.css';

async function repoCall(op: string, params: unknown) {
  const response = await fetch('/fixture-pds', { method: 'POST', body: JSON.stringify({ op, params }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { name: data.error === 'RecordNotFound' ? 'RecordNotFoundError' : 'Error' });
  return { data };
}
const agent = {
  assertDid: 'did:plc:tutorial',
  getProfile: async () => ({ data: { displayName: 'たびびと', handle: 'tutorial.invalid' } }),
  com: { atproto: {
    repo: {
      getRecord: (p: unknown) => repoCall('get', p),
      putRecord: (p: unknown) => repoCall('put', p),
      listRecords: (p: unknown) => repoCall('list', p),
      createRecord: (p: unknown) => repoCall('put', p),
    },
    server: { getServiceAuth: async () => ({ data: { token: 'isolated-fixture-token' } }) },
  } },
} as unknown as Agent;
createRoot(document.getElementById('root')!).render(
  <MemoryRouter><SessionContext.Provider value={{ status: 'signed-in', did: agent.assertDid, agent }}><World /></SessionContext.Provider></MemoryRouter>,
);
