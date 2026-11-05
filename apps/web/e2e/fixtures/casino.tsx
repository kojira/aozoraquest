// カジノの窓とパーティの なまえのふだ (D-CASINO-001) の 390px の見た目。本物の部品に、決まった結果を返す操作を渡す。
import React from 'react';
import { createRoot } from 'react-dom/client';
import { setMonsterOverrides, xpForAllyLevel, type CasinoSpot, type PartyRecruit } from '@aozoraquest/core';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import { CasinoModal, type CasinoActions } from '../../src/components/casino-modal';
import { PartyModal } from '../../src/components/party-modal';
import type { ServerParty } from '../../src/lib/world-server';
import '../../src/styles.css';

setMonsterOverrides(TEST_MONSTERS);
const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'exchange';
if (q.get('warned') === '1') localStorage.setItem('aozora:casino-first-exchange', '1');
const runners = TEST_MONSTERS.slice(0, 5).map((m) => ({ id: m.id, name: m.name, species: m.species }));
const actions: CasinoActions = {
  exchange: async (p) => ({ coins: 120 + p * 10, power: 40 - p }),
  bonus: async () => ({ coins: 170 }),
  prize: async () => ({ coins: 0 }),
  play: async (game, body) => {
    if (game === 'slots') return { coins: 260, outcomes: [{ game: 'slots', reels: ['star', 'star', 'star'], respun: null, payout: 1500 }] };
    if (game === 'highlow') return body.choice?.pick ? { coins: 110, outcomes: [{ game: 'highlow', first: 4, second: 9, win: true, payout: 24 }], highlow: { first: 9, stake: 24, step: 1, canContinue: true } } : { coins: 110, highlow: { first: 4, stake: 10, step: 0, canContinue: true } };
    return { coins: 150, outcomes: [{ game: 'race', runner: 0, winner: 0, payout: 24 }], race: { runners } };
  },
  raceLineup: async () => runners,
};
const spots: Record<string, CasinoSpot> = { exchange: { kind: 'exchange' }, prize: { kind: 'prize' }, slots: { kind: 'game', game: 'slots' }, highlow: { kind: 'game', game: 'highlow' }, race: { kind: 'game', game: 'race' } };
const recruit = (id: string, name: string, archetype: PartyRecruit['archetype']): PartyRecruit => ({ id, name, archetype, star: 2, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel(archetype, 5) });
const party: ServerParty = { ids: ['g:m', 'g:k'], members: [recruit('g:m', 'ミオ', 'miko'), recruit('g:k', 'カイト', 'warrior')] };

function App() {
  if (view === 'rename') return <PartyModal jobLevel={5} load={async () => ({ party, flags: [] })} onClose={() => {}} rename={{ tags: 2, save: async () => {} }} />;
  return <div style={{ minHeight: '100svh', background: '#223' }}><CasinoModal spot={spots[view]!} coins={view === 'prize' ? 16_500 : 120} power={40} actions={actions} onClose={() => {}} /></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
