// Isolated browser contract for the battle target picker (BattleTargetPicker); no network or player state writes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { playerCombatant, setMonsterOverrides, startBattle, type Archetype, type BattleState, type Combatant } from '@aozoraquest/core';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import { WorldBattleControls } from '../../src/components/world-battle-controls';
import '../../src/styles.css';

const mate = (archetype: Archetype, level: number, name: string, over: Partial<Combatant> = {}): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level }, ...over });
setMonsterOverrides(TEST_MONSTERS);
const params = new URLSearchParams(location.search);
const enemyCount = Number(params.get('enemies') ?? '2');
const allyCount = Number(params.get('allies') ?? '1');

function Battle() {
  const base = startBattle('paladin', 5, 5, 'ゆうしゃ', 1, 3, 2);
  const enemyNames = ['そらいろスライム', 'すなウサギ', 'もりのコウモリ'];
  const enemies = enemyNames.slice(0, enemyCount).map((name) => ({ ...base.monster, name }));
  const mates = [mate('warrior', 5, 'カイト', { hp: 6 }), mate('mage', 5, 'ソラ', { hp: 8 }), mate('miko', 5, 'ミオ', { hp: 9 })];
  const allies = [{ ...base.player, hp: 14 }, ...mates.slice(0, allyCount - 1)];
  const s: BattleState = { ...base, player: allies[0]!, monster: enemies[0]!, allies, enemies, turn: 1, lastEvents: [] };
  return (
    <div style={{ height: '100svh', display: 'flex', flexDirection: 'column', background: '#335', color: '#fff' }}>
      <WorldBattleControls state={s} phase="input" busy={false} showEnemyVitals={false} resultLines={[]} onAdvance={() => {}} onCommand={() => {}} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Battle />);
