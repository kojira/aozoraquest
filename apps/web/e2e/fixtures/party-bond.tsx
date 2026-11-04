// Isolated browser contract for the production components (D-PARTY-004 きずな); no network or player state writes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { playerCombatant, setMonsterOverrides, startBattle, xpForAllyLevel, type Archetype, type BattleState, type Combatant, type PartyRecruit } from '@aozoraquest/core';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import { PartyModal } from '../../src/components/party-modal';
import { PartyGearModal } from '../../src/components/party-gear-modal';
import { WorldBattleControls } from '../../src/components/world-battle-controls';
import { useAllyOrders } from '../../src/lib/battle-ally-orders';
import type { ServerParty } from '../../src/lib/world-server';
import '../../src/styles.css';

setMonsterOverrides(TEST_MONSTERS);
const recruit = (id: string, name: string, archetype: PartyRecruit['archetype'], level: number): PartyRecruit => ({ id, name, archetype, star: 2, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel(archetype, level) });
const MIO = recruit('g:m', 'ミオ', 'miko', 6), KAI = recruit('g:k', 'カイト', 'warrior', 5), SORA = recruit('g:s', 'ソラ', 'mage', 7);
const party: ServerParty = { ids: [MIO.id, KAI.id, SORA.id], members: [MIO, KAI, SORA], hp: { [KAI.id]: 9 }, bond: { [MIO.id]: 72, [KAI.id]: 20, [SORA.id]: 150 }, mode: { [SORA.id]: 'manual' } };
const view = new URLSearchParams(location.search).get('view') ?? 'party';

function Party() {
  return <PartyModal jobLevel={5} load={async () => ({ party, flags: [] })} onClose={() => {}} onMode={async () => {}} />;
}

const mate = (archetype: Archetype, level: number, name: string): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level } });
function Battle() {
  const base = startBattle('warrior', 7, 7, 'ゆうしゃ', 1, 3, 2, undefined, { extraEnemies: 1 });
  const allies = [base.player, mate('miko', 6, 'ミオ'), mate('mage', 7, 'ソラ')];
  const s: BattleState = { ...base, allies, enemies: base.enemies!, turn: 1, lastEvents: [], allyModes: [undefined, 'inochi', 'manual'], partyIds: ['g:m', 'g:s'] };
  const [sent, setSent] = React.useState('');
  const o = useAllyOrders(s, 'b:1:input', (h, a) => setSent(JSON.stringify({ hero: h, allies: a })));
  return (
    <div style={{ height: '100svh', display: 'flex', flexDirection: 'column', background: '#335', color: '#fff', padding: '0.5em', paddingTop: '2.7em', boxSizing: 'border-box' }}>
      <WorldBattleControls state={o.view ?? s} phase="input" busy={false} showEnemyVitals={false} resultLines={[]} onAdvance={() => {}} onCommand={o.onCommand}
        allyOrder={o.heading ? { heading: o.heading, allyTurn: o.allyTurn, onBack: o.back, onAuto: o.auto } : undefined} />
      <div data-testid="sent" style={{ fontSize: 10 }}>{sent}</div>
    </div>
  );
}

/** そうび: ソラ が たびのつるぎ (1 本だけ) を着ている。主人公の画面では「ソラが そうび中」。 */
function Gear() {
  const pieces = [
    { rkey: 'p1', itemId: 'wp-travel-sword', level: 0, at: '' }, { rkey: 'p2', itemId: 'wp-club', level: 1, at: '' },
    { rkey: 'p3', itemId: 'ar-leather', level: 0, at: '' }, { rkey: 'p4', itemId: 'hd-leather-hat', level: 0, at: '' },
  ];
  const gearParty: ServerParty = { ...party, gear: { [SORA.id]: { weapon: { id: 'wp-travel-sword', level: 0 } } } };
  return <PartyGearModal archetype="warrior" heroName="ゆうしゃ" pieces={pieces} refs={{ armor: 'p3' }} party={gearParty} jobLevel={7}
    onEquip={() => {}} onUnequip={() => {}} onDiscard={() => {}} saveAllyGear={async () => {}} onClose={() => {}} />;
}

createRoot(document.getElementById('root')!).render(view === 'battle' ? <Battle /> : view === 'gear' ? <Gear /> : <Party />);
