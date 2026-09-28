// Isolated browser contract for the production component; no network or player state writes.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogueWindow } from '../../src/components/dialogue-window';
import worried from '../../src/assets/futaba/bluesky-worried.webp';
import smile from '../../src/assets/futaba/bluesky-smile.webp';
import '../../src/styles.css';

const name = 'Blueskyちゃん';
const lines = [
  { speaker: name, text: '……きこえる？ だいじょうぶ？', portrait: { src: worried, name } },
  { speaker: name, text: 'マップを おしたまま 指を うごかすと 移動。'.repeat(16) + '【説明のおわり】', portrait: { src: smile, name } },
  { text: '少女は やくそうを とりだした。' },
  { speaker: '村人', text: '絵のない会話。' },
  { speaker: name, text: '冒険者ギルドへ ようこそ。どうする？', portrait: { src: smile, name } },
];
function App() {
  const [done, setDone] = useState(false);
  return <div style={{ maxWidth: 560, margin: '0 auto' }}><div className="dq-window" style={{ padding: 4 }}>
    <div data-testid="map-inner" style={{ position: 'relative', aspectRatio: '1' }}>
      {done ? <p>会話終了</p> : <DialogueWindow anchor={new URLSearchParams(location.search).has('viewport') ? 'viewport' : 'map'} lines={lines} onDone={() => setDone(true)}
        choices={['依頼を見る', '報告する', '話す', 'やめる'].map(label => ({ label, onSelect: () => {} }))} />}
    </div>
  </div></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
