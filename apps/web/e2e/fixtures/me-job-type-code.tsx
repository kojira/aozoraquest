// Test entry only: real MyProfile (/me) with an offline agent returning a fixed diagnosis
// (sage) and target job (bard). Verifies 「賢者(INTJ)」 next to the job name.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import type { DiagnosisResult } from '@aozoraquest/core';
import { SessionContext } from '../../src/lib/session';
import { MyProfile } from '../../src/routes/me';
import '../../src/styles.css';

const did = 'did:plc:mefixture';
const analysis: DiagnosisResult = {
  archetype: 'sage',
  rpgStats: { atk: 30, def: 50, agi: 40, int: 95, luk: 60 },
  cognitiveScores: { Ni: 90, Ne: 60, Si: 50, Se: 30, Ti: 80, Te: 50, Fi: 40, Fe: 55 },
  confidence: 'high',
  analyzedPostCount: 250,
  analyzedAt: '2026-04-15T00:00:00Z',
};
const notFound = () => Object.assign(new Error('RecordNotFound'), { name: 'RecordNotFoundError' });
const agent = {
  assertDid: did, did,
  com: { atproto: { repo: {
    getRecord: async ({ collection }: { collection: string }) => {
      if (collection.endsWith('.analysis')) return { data: { value: analysis } };
      if (collection.endsWith('.profile')) return { data: { value: { targetJob: 'bard' } } };
      throw notFound();
    },
    listRecords: async () => ({ data: { records: [] } }),
  } } },
} as unknown as Agent;

const router = createMemoryRouter([{ path: '/me', element: <MyProfile /> }], { initialEntries: ['/me'] });

createRoot(document.getElementById('root')!).render(
  <SessionContext.Provider value={{ status: 'signed-in', did, handle: 'me.invalid', agent }}>
    <main style={{ padding: '0.8em' }}><RouterProvider router={router} /></main>
  </SessionContext.Provider>,
);
