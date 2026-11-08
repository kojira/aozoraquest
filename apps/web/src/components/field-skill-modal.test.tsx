// @vitest-environment jsdom
/**
 * フィールドの「とくぎ」(D-PARTY-003): 唱える人 → とくぎ → 相手 → 結果の文。
 * 回復のとくぎを覚えていない人は出ない。MP が足りない人は押せない。全体回復は相手を選ばない。
 * どうぐの窓: 仲間がいれば やくそうの相手を選び、倒れた仲間には使えない。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { playerCombatant, type Archetype, type Combatant } from '@aozoraquest/core';
import { FieldSkillModal, fieldSkillMessage, type FieldMember } from './field-skill-modal';
import { ItemsModal } from './world-item-modals';

const who = (id: string, name: string, archetype: Archetype, level: number, over: Partial<Combatant> = {}): FieldMember => ({
  id, c: { ...playerCombatant(archetype, level, 1, name), job: { archetype, level }, ...over },
});
afterEach(cleanup);

describe('FieldSkillModal', () => {
  const hero = who('hero', 'ゆうしゃ', 'warrior', 5, { hp: 10 });
  const pal = who('g:p', 'ハル', 'paladin', 5);
  const miko = who('g:m', 'ミオ', 'miko', 5, { mp: 0 });

  it('唱える人は回復のとくぎを覚えている人だけ。MP が足りない人は押せない', () => {
    render(<FieldSkillModal members={[hero, pal, miko]} cast={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('だれが となえる？')).toBeTruthy();
    expect(screen.queryByText('ゆうしゃ')).toBeNull();
    expect((screen.getByRole('button', { name: 'えらぶ' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'MPが たりない' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ハル → 聖光の癒し → ゆうしゃ で cast を呼び、「ハルは 聖光の癒しを となえた！ ゆうしゃの HPが N かいふくした。」', async () => {
    const cast = vi.fn(async () => ({ casterName: 'ハル', skillName: '聖光の癒し', healed: [{ id: 'hero', name: 'ゆうしゃ', amount: 9 }] }));
    render(<FieldSkillModal members={[hero, pal]} cast={cast} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'えらぶ' }));
    expect(screen.getByText('聖光の癒し')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'となえる' }));
    expect(screen.getByText('だれを かいふくする？')).toBeTruthy();
    expect((screen.getAllByRole('button', { name: 'まんたん' })[0] as HTMLButtonElement).disabled).toBe(true); // ハルは満タン
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'かいふく' })); });
    expect(cast).toHaveBeenCalledWith('g:p', 'paladin-heal', 'hero');
    expect(screen.getByText('ハルは 聖光の癒しを となえた！ ゆうしゃの HPが 9 かいふくした。')).toBeTruthy();
  });

  it('全体回復 (癒しの鈴) は相手を選ばずに唱える', async () => {
    const m = who('g:m', 'ミオ', 'miko', 5);
    const cast = vi.fn(async () => ({ casterName: 'ミオ', skillName: '癒しの鈴', healed: [{ id: 'hero', name: 'ゆうしゃ', amount: 5 }, { id: 'g:m', name: 'ミオ', amount: 0 }] }));
    render(<FieldSkillModal members={[hero, m]} cast={cast} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'えらぶ' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'となえる' })); });
    expect(cast).toHaveBeenCalledWith('g:m', 'miko-heal-bell', undefined);
    expect(screen.queryByText('だれを かいふくする？')).toBeNull();
  });

  it('サーバーが断ったら、その理由を出す', async () => {
    const cast = vi.fn(async () => { throw new Error('MPが たりない'); });
    render(<FieldSkillModal members={[hero, pal]} cast={cast} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'えらぶ' }));
    fireEvent.click(screen.getByRole('button', { name: 'となえる' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'かいふく' })); });
    expect(screen.getByText('MPが たりない')).toBeTruthy();
  });

  it('fieldSkillMessage は全体回復の人数ぶん並べる', () => {
    expect(fieldSkillMessage({ casterName: 'ミオ', skillName: '癒しの鈴', healed: [{ id: 'hero', name: 'ゆうしゃ', amount: 5 }, { id: 'g:m', name: 'ミオ', amount: 3 }] }))
      .toBe('ミオは 癒しの鈴を となえた！ ゆうしゃの HPが 5 かいふくした。 ミオの HPが 3 かいふくした。');
  });
});

describe('ItemsModal の相手えらび (D-PARTY-003)', () => {
  it('仲間がいれば やくそうは相手を選ぶ。倒れた仲間は押せない。仲間を選ぶと onUseOnAlly', async () => {
    const hero = who('hero', 'ゆうしゃ', 'warrior', 5, { hp: 10 });
    const hurt = who('g:p', 'ハル', 'paladin', 5, { hp: 3 });
    const down = who('g:m', 'ミオ', 'miko', 5, { hp: 0 });
    const onUseOnAlly = vi.fn(async () => 'ハルに やくそうを使った! HPが9回復。');
    const onUseHerb = vi.fn();
    render(<ItemsModal herbStock={2} tonicStock={0} featherStock={0} canUse onUseHerb={onUseHerb} onUseTonic={vi.fn()} onUseFeather={vi.fn()} onClose={vi.fn()} members={[hero, hurt, down]} onUseOnAlly={onUseOnAlly} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'つかう' })[0]!);
    expect(screen.getByText('やくそうを だれに つかう？')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'たおれている' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'つかう' })[1]!); });
    expect(onUseOnAlly).toHaveBeenCalledWith('herb', hurt);
    expect(onUseHerb).not.toHaveBeenCalled();
    expect(screen.getByText('ハルに やくそうを使った! HPが9回復。')).toBeTruthy();
  });

  it('1 人なら今までどおり、すぐ主人公に使う', () => {
    const onUseHerb = vi.fn(() => 'やくそうを使った! HPが5回復。');
    render(<ItemsModal herbStock={1} tonicStock={0} featherStock={0} canUse onUseHerb={onUseHerb} onUseTonic={vi.fn()} onUseFeather={vi.fn()} onClose={vi.fn()} members={[who('hero', 'ゆうしゃ', 'warrior', 5)]} onUseOnAlly={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'つかう' })[0]!);
    expect(onUseHerb).toHaveBeenCalledOnce();
  });
});
