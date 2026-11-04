// Isolated browser contract for the production components (D-PARTY-004 きずな); no network or player state writes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { xpForAllyLevel, type PartyRecruit } from '@aozoraquest/core';
import { PartyModal } from '../../src/components/party-modal';
import type { ServerParty } from '../../src/lib/world-server';
import '../../src/styles.css';

const recruit = (id: string, name: string, archetype: PartyRecruit['archetype'], level: number): PartyRecruit => ({ id, name, archetype, star: 2, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel(archetype, level) });
const MIO = recruit('g:m', 'ミオ', 'miko', 6), KAI = recruit('g:k', 'カイト', 'warrior', 5), SORA = recruit('g:s', 'ソラ', 'mage', 7);
const party: ServerParty = { ids: [MIO.id, KAI.id, SORA.id], members: [MIO, KAI, SORA], hp: { [KAI.id]: 9 }, bond: { [MIO.id]: 72, [KAI.id]: 20, [SORA.id]: 150 } };

function Party() {
  return <PartyModal jobLevel={5} load={async () => ({ party, flags: [] })} onClose={() => {}} />;
}

createRoot(document.getElementById('root')!).render(<Party />);
