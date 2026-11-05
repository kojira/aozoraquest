// Test entry only: Gemini Nano の無いブラウザで、精霊タブの召喚の儀式 (確認シート → ブルスコン = LFM2.5 の導入) → 英語投稿の翻訳 を本物のモジュールで動かす。
// ?spirit は召喚済みユーザーの精霊タブ (本物の Spirit。PDS は書き込み回数を数えるだけの偽 agent)。?privacy はプライバシーポリシー。
// ?card はカード画面 (本物の Card。診断済み・召喚済みで、まだカードが無い)。書いたカードは window.savedCard に残る。
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { PostBody } from '../../src/components/post-body';
import { Spirit } from '../../src/routes/spirit';
import { Privacy } from '../../src/routes/privacy';
import { Card } from '../../src/routes/card';
import { SessionContext } from '../../src/lib/session';
import '../../src/styles.css';

const POST = 'Just finished reading a great book about space. Highly recommend it!';
const w = window as unknown as { pdsWrites: number; savedCard?: Record<string, unknown> };

function App() {
  return (
    <div style={{ padding: '1em' }}>
      <PostBody text={POST} postUri="at://did:plc:sara/app.bsky.feed.post/1" langs={['en']} />
    </div>
  );
}

const DID = 'did:plc:slmtranslatione2e';
w.pdsWrites = 0;
// ?unsummoned は召喚前 (投稿は足りている) のユーザー
const summonedPower = { viaPosts: 12, userMessages: 0, cardDraws: 0, summoned: !new URLSearchParams(location.search).has('unsummoned'), updatedAt: '2026-01-01T00:00:00Z' };
const fakeAgent = {
  assertDid: DID,
  com: { atproto: { repo: {
    getRecord: async ({ collection }: { collection: string }) => {
      if (collection.endsWith('.power')) return { data: { value: summonedPower } };
      if (collection.endsWith('.analysis')) return { data: { value: w.savedCard ?? DIAGNOSIS } };
      throw Object.assign(new Error('RecordNotFound'), { name: 'RecordNotFoundError' });
    },
    listRecords: async ({ collection }: { collection: string }) =>
      ({ data: { records: collection.endsWith('.spiritChat') && summonedPower.summoned ? [{ value: {} }] : [] } }),
    createRecord: async () => { w.pdsWrites++; return { data: {} }; },
    putRecord: async ({ collection, record }: { collection: string; record: Record<string, unknown> }) => {
      w.pdsWrites++;
      if (collection.endsWith('.analysis')) w.savedCard = record;
      return { data: {} };
    },
  } } },
  getProfile: async () => ({ data: { did: DID, handle: 'test.example', displayName: 'テスト' } }),
  getFollows: async () => ({ data: { follows: [] } }),
} as unknown as Agent;

const DIAGNOSIS = {
  archetype: 'sage', rpgStats: { atk: 10, def: 10, agi: 10, int: 10, luk: 10 }, cognitiveScores: {}, confidence: 'high',
  analyzedPostCount: 50, analyzedAt: '2026-01-01T00:00:00Z',
};

const root = createRoot(document.getElementById('root')!);
const q = new URLSearchParams(location.search);
if (q.has('card')) {
  root.render(
    <SessionContext.Provider value={{ status: 'signed-in', did: DID, handle: 'test.example', agent: fakeAgent }}>
      <MemoryRouter><div style={{ padding: '1em' }}><Card /></div></MemoryRouter>
    </SessionContext.Provider>,
  );
} else if (q.has('privacy')) {
  root.render(<div style={{ padding: '1em' }}><Privacy /></div>);
} else if (q.has('spirit')) {
  root.render(
    <SessionContext.Provider value={{ status: 'signed-in', did: DID, handle: 'test.example', agent: fakeAgent }}>
      <MemoryRouter><div style={{ padding: '1em' }}><Spirit /></div></MemoryRouter>
    </SessionContext.Provider>,
  );
} else {
  root.render(<App />);
}
