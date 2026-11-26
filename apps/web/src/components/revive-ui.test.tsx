// @vitest-environment jsdom
/**
 * 倒れた仲間の画面 (D-REVIVE-001)。
 * - 戦闘の相手えらび side='down' は倒れた味方だけを並べ、「倒れた味方の何番目か」を返す
 * - 戦闘の味方の段・なかまの窓: 倒れた仲間に「たおれている」
 * - フィールドの とくぎ: 目覚めの祈り は倒れた仲間だけを並べる
 * - フィールドの どうぐ: めざめのはね は倒れた仲間だけ、回復のどうぐは生きている人だけ
 * - 宿の人の一言: 倒れた仲間がいれば ほこら の町を教える
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EQUIPMENT, activeItems, playerCombatant, setItemOverrides, startBattle, type Archetype, type BattleState, type Combatant } from '@aozoraquest/core';
import { BattleTargetPicker } from './battle-target-picker';
import { BattleAllyRow } from './battle-ally-row';
import { FieldSkillModal, type FieldMember } from './field-skill-modal';
import { FieldHealItemRows } from './field-heal-items';
import { innDownedLine } from '@/lib/use-inn-talk';

const who = (id: string, name: string, archetype: Archetype, level: number, over: Partial<Combatant> = {}): FieldMember => ({
  id, c: { ...playerCombatant(archetype, level, 1, name), job: { archetype, level }, ...over },
});
const Row = ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) => <button type="button" onClick={onClick} disabled={disabled}>{label}</button>;
afterEach(() => { cleanup(); setItemOverrides(null); });

function partyState(): BattleState {
  const s = startBattle('miko', 20, 1, 'ゆうしゃ', 1, 3, 0);
  const a = { ...playerCombatant('warrior', 10, 1, 'カイ'), hp: 0 };
  const b = { ...playerCombatant('mage', 10, 1, 'ソラ'), hp: 5 };
  const c = { ...playerCombatant('guardian', 10, 1, 'ハル'), hp: 0 };
  return { ...s, allies: [s.player, a, b, c], enemies: [s.monster] };
}

describe('戦闘の相手えらび (side=down)', () => {
  it('倒れた味方だけを並べ、倒れた味方の何番目かを返す', () => {
    const onPick = vi.fn();
    render(<BattleTargetPicker state={partyState()} busy={false} Row={Row} onPick={onPick} onCancel={vi.fn()} side="down" />);
    expect(screen.queryByText('ソラ')).toBeNull();
    expect(screen.queryByText('ゆうしゃ')).toBeNull();
    fireEvent.click(screen.getByText('ハル'));
    expect(onPick).toHaveBeenCalledWith(1);
  });
});

describe('倒れた仲間の表示', () => {
  it('戦闘の味方の段に「たおれている」', () => {
    const { container } = render(<BattleAllyRow state={partyState()} />);
    expect(container.querySelectorAll('[data-down]')).toHaveLength(2);
    expect(screen.getAllByText('たおれている')).toHaveLength(2);
  });
});

describe('フィールドの 目覚めの祈り', () => {
  it('倒れた仲間だけを並べ、おこす で cast する', async () => {
    const hero = who('hero', 'ゆうしゃ', 'warrior', 20, { hp: 10 });
    const miko = who('g:m', 'ミオ', 'miko', 20);
    const kai = who('g:k', 'カイ', 'warrior', 10, { hp: 0 });
    const cast = vi.fn(async () => ({ casterName: 'ミオ', skillName: '目覚めの祈り', healed: [{ id: 'g:k', name: 'カイ', amount: 19 }] }));
    render(<FieldSkillModal members={[hero, miko, kai]} cast={cast} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'えらぶ' }));
    const row = screen.getByText('目覚めの祈り').closest('div')!;
    fireEvent.click(row.querySelector('button')!);
    expect(screen.getByText('だれを おこす？')).toBeTruthy();
    expect(screen.queryByText('ゆうしゃ')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'おこす' })); });
    expect(cast).toHaveBeenCalledWith('g:m', 'revive-prayer', 'g:k');
    expect(screen.getByText(/カイが いきかえった! \(HP 19\)/)).toBeTruthy();
  });
});

describe('フィールドの 回復・生き返らせるどうぐ', () => {
  const items = [
    { id: 'mezame-hane', name: 'めざめのはね', precious: true, battle: { effects: [{ kind: 'heal' as const, amount: 50, target: 'oneDownAlly' as const }] } },
    { id: 'kizu-gusuri', name: 'きずぐすり', battle: { effects: [{ kind: 'heal' as const, amount: 30 }] } },
  ];
  const members = [who('hero', 'ゆうしゃ', 'warrior', 20, { hp: 10 }), who('g:k', 'カイ', 'warrior', 10, { hp: 0 })];

  it('めざめのはね は倒れた仲間だけ、回復のどうぐは生きている人だけ', async () => {
    setItemOverrides({ items: [...activeItems(), ...items], equipment: [...EQUIPMENT] });
    const use = vi.fn(async () => 'カイが いきかえった! (HP 50)');
    const onMessage = vi.fn();
    render(<FieldHealItemRows materials={{ 'mezame-hane': 1, 'kizu-gusuri': 1 }} members={members} use={use} onMessage={onMessage} />);
    expect(screen.getByText('たおれた なかまを おこす')).toBeTruthy();
    expect(screen.getByText('HPを 30 回復')).toBeTruthy();
    fireEvent.click(screen.getByText('めざめのはね').closest('div')!.querySelector('button')!);
    expect(screen.queryByText('ゆうしゃ')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'つかう' })); });
    expect(use).toHaveBeenCalledWith('mezame-hane', members[1]);
    expect(onMessage).toHaveBeenCalledWith('カイが いきかえった! (HP 50)');
  });
});

describe('宿の人の一言', () => {
  it('倒れた仲間がいれば ほこら の町を教え、いなければ何も言わない', () => {
    expect(innDownedLine('やどや', { count: 1, shrineTown: 'ふたばの村' })[0]!.text).toContain('「ふたばの村」の ほこら');
    expect(innDownedLine('やどや', undefined)).toEqual([]);
  });
});
