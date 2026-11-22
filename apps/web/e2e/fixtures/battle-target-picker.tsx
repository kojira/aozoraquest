// Isolated browser contract for the battle windows (BattleTargetPicker, skill list, command menu); no network or player state writes.
// The battle is drawn inside the same square map frame and overlay as routes/world.tsx (the real size on a phone).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { playerCombatant, setMonsterOverrides, skillsForJob, startBattle, type Archetype, type BattleState, type Combatant } from '@aozoraquest/core';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import { WorldBattleControls } from '../../src/components/world-battle-controls';
import '../../src/styles.css';

const mate = (archetype: Archetype, level: number, name: string, over: Partial<Combatant> = {}): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level }, ...over });
setMonsterOverrides(TEST_MONSTERS);
const params = new URLSearchParams(location.search);
const enemyCount = Number(params.get('enemies') ?? '2');
const allyCount = Number(params.get('allies') ?? '1');
const job = (params.get('job') ?? 'paladin') as Archetype;
const jobLevel = Number(params.get('lv') ?? '5');
const vitals = params.get('vitals') === '1';

function Battle() {
  const base = startBattle(job, jobLevel, 5, 'ゆうしゃ', 1, 3, 2);
  const enemyNames = ['そらいろスライム', 'すなウサギ', 'もりのコウモリ', 'こけむしゴーレム', 'よぞらカラス'];
  const ids = ['sky-slime', 'grass-slime', 'cave-bat', 'pale-shroom', 'gale-raven'];
  const enemies = enemyNames.slice(0, enemyCount).map((name, i) => ({ ...base.monster, name, monsterId: ids[i]! }));
  const mates = [mate('warrior', 5, 'カイト', { hp: 6 }), mate('mage', 5, 'ソラ', { hp: 8 }), mate('miko', 5, 'ミオ', { hp: 9 })];
  const allies = [{ ...base.player, hp: 14 }, ...mates.slice(0, allyCount - 1)];
  const s: BattleState = { ...base, player: { ...allies[0]!, mp: 99 }, monster: enemies[0]!, allies: [{ ...allies[0]!, mp: 99 }, ...allies.slice(1)], enemies, turn: 1, lastEvents: [],
    playerSkills: skillsForJob(job, jobLevel) };
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '0.6em 0.5em', background: '#000', minHeight: '100svh', boxSizing: 'border-box' }}>
      <div className="dq-window" style={{ padding: 4 }}>
        <div style={{ position: 'relative', aspectRatio: '1', background: '#3a5' }}>
          <div data-battle-overlay style={{ position: 'absolute', inset: 0, background: 'rgba(8, 10, 16, 0.92)', display: 'flex', flexDirection: 'column', padding: '0.5em', paddingTop: '2.7em', overflow: 'hidden', color: '#fff' }}>
            <WorldBattleControls state={s} phase="input" busy={false} showEnemyVitals={vitals} resultLines={[]} onAdvance={() => {}} onCommand={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Battle />);
