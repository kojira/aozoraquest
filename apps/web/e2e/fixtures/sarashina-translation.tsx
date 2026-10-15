// Test entry only: Gemini Nano の無いブラウザで、召喚の儀式 (sarashina の導入) → 英語投稿の翻訳 を本物のモジュールで動かす。
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Agent } from '@atproto/api';
import { SummoningRitual } from '../../src/components/summoning-ritual';
import { PostBody } from '../../src/components/post-body';
import '../../src/styles.css';

const POST = 'Just finished reading a great book about space. Highly recommend it!';
const w = window as unknown as Record<string, unknown>;

function App() {
  const [ritual, setRitual] = useState(new URLSearchParams(location.search).has('ritual'));
  const [welcome, setWelcome] = useState('');
  return (
    <div style={{ padding: '1em' }}>
      {welcome && <p data-testid="welcome">{welcome}</p>}
      {!ritual && !welcome && <PostBody text={POST} postUri="at://did:plc:sara/app.bsky.feed.post/1" langs={['en']} />}
      {ritual && (
        <SummoningRitual
          agent={{} as Agent}
          userName="テスト"
          systemPrompt=""
          onComplete={(t) => { setWelcome(t); setRitual(false); w.ritualDone = true; }}
          onCancel={() => setRitual(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
