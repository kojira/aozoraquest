// Test entry only: Gemini Nano の無いブラウザで、精霊タブの召喚の儀式 (確認シート → ブルスコン = LFM2.5 の導入) → 英語投稿の翻訳 を本物のモジュールで動かす。
// ?spirit は召喚済みユーザーの精霊タブ (本物の Spirit。PDS は書き込み回数を数えるだけの偽 agent)。?privacy はプライバシーポリシー。
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { PostBody } from '../../src/components/post-body';
import { Spirit } from '../../src/routes/spirit';
import { Privacy } from '../../src/routes/privacy';
import { SessionContext } from '../../src/lib/session';
import '../../src/styles.css';

const POST = 'Just finished reading a great book about space. Highly recommend it!';
const w = window as unknown as { pdsWrites: number };

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
      throw Object.assign(new Error('RecordNotFound'), { name: 'RecordNotFoundError' });
    },
    listRecords: async () => ({ data: { records: [] } }),
    createRecord: async () => { w.pdsWrites++; return { data: {} }; },
    putRecord: async () => { w.pdsWrites++; return { data: {} }; },
  } } },
} as unknown as Agent;

const root = createRoot(document.getElementById('root')!);
const q = new URLSearchParams(location.search);
if (q.has('privacy')) {
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
