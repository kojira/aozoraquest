// Isolated browser contract: the production quest list (useNpcQuestTalk) in the production DialogueWindow.
// No network or player state writes (agent is null; the list only opens choices).
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { setGameQuests, setNpcs, type GameQuestDef, type NpcDef } from '@aozoraquest/core';
import { DialogueWindow } from '../../src/components/dialogue-window';
import { useNpcQuestTalk } from '../../src/lib/use-npc-quest-talk';
import '../../src/styles.css';

const WELL: NpcDef = { id: 'well', name: '井戸番', x: 1, y: 1, lines: ['井戸が かれて こまっている。'] };
const KID: NpcDef = { id: 'kid', name: '町の こども', x: 2, y: 1, lines: ['あそぼ'] };
const talk = (id: string, title: string, npcId: string): GameQuestDef => ({ id, title, npcId: 'well', intro: ['たのむ'], done: ['ありがとう'], objective: { kind: 'talk', npcId, line: 'やあ' } });
const quests = [talk('well-lord', 'かれ井戸の ぬし', 'well'), talk('well-seed', 'かれ井戸の たね', 'kid'),
  { ...talk('well-drop', 'しずくあつめ', 'well'), objective: { kind: 'collect' as const, itemId: 'slime-drop', count: 2 } }];
setNpcs([WELL, KID]);
setGameQuests(quests);

function App() {
  const t = useNpcQuestTalk({
    agent: null, moveBusyRef: { current: false }, tokenRef: { current: undefined }, flagsRef: { current: [] }, materialsRef: { current: {} },
    applyServerMaterials: () => {}, setServerPower: () => {}, setNotice: () => {}, waitForFreshDirectionRef: { current: false }, startEncounterRef: { current: () => {} },
  });
  useEffect(() => {
    t.setQuest({ activeQuests: quests.map(q => ({ id: q.id, progress: 0 })), done: [] });
    t.directQuestList(WELL);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open the list once
  }, []);
  return <div style={{ maxWidth: 560, margin: '0 auto' }}><div className="dq-window" style={{ padding: 4 }}>
    <div data-testid="map-inner" style={{ position: 'relative', aspectRatio: '1' }}>
      {t.npcTalk ? <DialogueWindow conversationStep={t.npcTalk} anchor="map" lines={t.npcTalk.lines.map(text => ({ speaker: t.npcTalk!.npc.name, text }))}
        choices={t.npcChoices} onDone={() => {}} /> : <p>会話終了</p>}
    </div>
  </div></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
