// Production components for D-TTS-001: the dialogue window with real Blueskyちゃん lines (npcDialogueLines → voice cue),
// the settings toggle and the privacy credit. Real download (HF + own origin) and real synthesis; no game state.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogueWindow } from '../../src/components/dialogue-window';
import { VoiceToggle, PrivacyVoiceCredit } from '../../src/components/voice/voice-toggle';
import { npcDialogueLines } from '../../src/lib/npc-image';
import smile from './futaba/bluesky-smile.webp';
import '../../src/styles.css';

const npc = { id: 'homura-bluesky', name: 'ほむらの Blueskyちゃん', spritePreset: 'bluesky' as const };
const lines = npcDialogueLines(npc, ['いらっしゃい！　ふたばのわたしから聞いてるよ、手紙を持った旅人さん。', 'ここがこの町の冒険者ギルドだよ。少し休んでいってね。'])
  .map((l) => ({ ...l, portrait: { src: smile, name: npc.name } }));
function App() {
  const view = new URLSearchParams(location.search).get('view');
  const [done, setDone] = useState(false);
  if (view === 'settings') return <div style={{ padding: 12 }}><h3 style={{ fontSize: '0.95em' }}>表示設定</h3><VoiceToggle variant="settings" /><hr /><PrivacyVoiceCredit /></div>;
  return <div style={{ maxWidth: 560, margin: '0 auto' }}><div className="dq-window" style={{ padding: 4 }}>
    <div data-testid="map-inner" style={{ position: 'relative', aspectRatio: '1' }}>
      {done ? <p>会話終了</p> : <DialogueWindow anchor="map" lines={lines} onDone={() => setDone(true)} />}
    </div></div></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
