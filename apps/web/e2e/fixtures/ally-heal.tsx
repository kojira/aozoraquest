// Isolated browser contract for the production components (D-PARTY-003); no network or player state writes.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { playerCombatant, setMonsterOverrides, startBattle, type Archetype, type BattleState, type Combatant } from '@aozoraquest/core';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import { WorldBattleControls } from '../../src/components/world-battle-controls';
import { FieldSkillModal, type FieldMember } from '../../src/components/field-skill-modal';
import { WorldMenu } from '../../src/components/world-menu';
import '../../src/styles.css';

const mate = (archetype: Archetype, level: number, name: string, over: Partial<Combatant> = {}): Combatant => ({ ...playerCombatant(archetype, level, 1, name), job: { archetype, level }, ...over });
setMonsterOverrides(TEST_MONSTERS);
const view = new URLSearchParams(location.search).get('view') ?? 'battle';

function Battle() {
  const base = startBattle('paladin', 5, 5, 'ゆうしゃ', 1, 3, 2, undefined, { tonics: 1 });
  const allies = [{ ...base.player, hp: 14 }, mate('warrior', 5, 'カイト', { hp: 6 }), mate('mage', 5, 'ソラ', { hp: 0 })];
  const s: BattleState = { ...base, player: allies[0]!, allies, enemies: [base.monster], turn: 1, lastEvents: [] };
  const [last, setLast] = useState('');
  return (
    <div style={{ height: '100svh', display: 'flex', flexDirection: 'column', background: '#335', color: '#fff' }}>
      <WorldBattleControls state={s} phase="input" busy={false} showEnemyVitals={false} resultLines={[]} onAdvance={() => {}}
        onCommand={(c, skillIndex, itemId, targetIndex) => setLast(JSON.stringify({ c, skillIndex, itemId, targetIndex }))} />
      <div data-testid="sent" style={{ fontSize: 10 }}>{last}</div>
    </div>
  );
}

function Field() {
  const [open, setOpen] = useState<'menu' | 'skill'>('menu');
  const members: FieldMember[] = [
    { id: 'hero', c: mate('warrior', 5, 'ゆうしゃ', { hp: 12 }) },
    { id: 'g:p', c: mate('paladin', 5, 'ハル') },
    { id: 'g:m', c: mate('miko', 5, 'ミオ', { hp: 9 }) },
  ];
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}><div className="dq-window" style={{ padding: 4 }}>
      <div style={{ position: 'relative', aspectRatio: '1', background: '#3a5' }}>
        {open === 'menu' && <WorldMenu onClose={() => {}} commands={[
          { key: 'items', label: 'どうぐ', onSelect: () => {} },
          { key: 'skill', label: 'とくぎ', onSelect: () => setOpen('skill') },
          { key: 'quests', label: 'クエスト', onSelect: () => {} },
          { key: 'party', label: 'なかま', onSelect: () => {} },
          { key: 'gear', label: 'そうび', onSelect: () => {} },
        ]} />}
      </div>
    </div>
    {open === 'skill' && <FieldSkillModal members={members} onClose={() => setOpen('menu')}
      cast={async (caster, skillId, target) => ({ casterName: 'ハル', skillName: '聖光の癒し', healed: [{ id: target ?? 'hero', name: members.find((m) => m.id === target)?.c.name ?? 'ゆうしゃ', amount: 9 }] })} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(view === 'field' ? <Field /> : <Battle />);
