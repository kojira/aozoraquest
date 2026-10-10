// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BattleState } from '@aozoraquest/core';
import { WorldBattleControls, type BattlePhase } from './world-battle-controls';

const fighter = (name: string, hp: number) => ({ name, hp, maxHp: 30, mp: 5, maxMp: 5, atk: 1, def: 1, agi: 1, int: 1, luk: 1, vit: 0, guarding: false, parrying: false, charging: false, focus: 0, statuses: [], passives: [] });
const state = (turn = 1): BattleState => ({
  seed: 1, turn, player: fighter('ゆうしゃ', 20), monster: fighter('スライム', 10), monsterId: 'none',
  playerSkill: { name: 'わざ', kind: 'smash' }, playerSkills: [{ name: 'わざ', kind: 'smash' }], outcome: 'ongoing',
  herbs: 0, herbsUsed: 0, tonics: 0, tonicsUsed: 0, mpAttackGain: 0, mpGuardGain: 0,
  lastEvents: [{ actor: 'player', text: 'ゆうしゃのこうげき! スライムに 5 のダメージ' }, { actor: 'monster', text: 'スライムは ねむっている…' }],
}) as unknown as BattleState;

function setup(phase: BattlePhase = 'message', busy = false) {
  const onAdvance = vi.fn();
  const view = render(<WorldBattleControls state={state()} phase={phase} busy={busy} showEnemyVitals={false} resultLines={['けいけんち 3']} onCommand={vi.fn()} onAdvance={onAdvance} />);
  return { onAdvance, view };
}
const shown = () => [...document.querySelectorAll('.dq-message [aria-hidden]')].map((e) => e.textContent).filter((t) => t && t !== '\u00a0');
const layer = () => document.querySelector<HTMLElement>('[data-battle-advance]');
const finishTyping = () => act(() => { vi.advanceTimersByTime(5_000); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('WorldBattleControls message 送り', () => {
  it('1 タップで 1 行ずつ増え、最後の行の あとで はじめて onAdvance', () => {
    const { onAdvance } = setup();
    finishTyping();
    expect(shown()).toEqual(['ゆうしゃのこうげき!']);
    fireEvent.click(layer()!);
    finishTyping();
    expect(shown()).toEqual(['ゆうしゃのこうげき!', 'スライムに 5 のダメージ']);
    fireEvent.click(document.querySelector('.dq-message')!);
    finishTyping();
    expect(shown()).toHaveLength(3);
    expect(onAdvance).not.toHaveBeenCalled();
    fireEvent.click(layer()!);
    expect(onAdvance).toHaveBeenCalledOnce();
  });
  it('タイプ中の タップは 全文に するだけ', () => {
    const { onAdvance } = setup();
    act(() => { vi.advanceTimersByTime(22); });
    fireEvent.click(layer()!);
    expect(shown()).toEqual(['ゆうしゃのこうげき!']);
    fireEvent.click(layer()!);
    act(() => { vi.advanceTimersByTime(22); });
    expect(shown()).toEqual(['ゆうしゃのこうげき!', 'ス']);
    expect(onAdvance).not.toHaveBeenCalled();
  });
  it('busy の間は 進まない', () => {
    const { onAdvance } = setup('message', true);
    finishTyping();
    for (let i = 0; i < 4; i++) fireEvent.click(layer()!);
    expect(shown()).toEqual(['ゆうしゃのこうげき!']);
    expect(onAdvance).not.toHaveBeenCalled();
  });
  it('input では 全画面の 送り面を 出さない (コマンドは そのまま押せる)', () => {
    setup('input');
    expect(layer()).toBeNull();
    expect(screen.getByRole('button', { name: 'たたかう' })).toBeTruthy();
  });
  it('result の 報酬行は まとめて 出し、送り面の タップで onAdvance', () => {
    const { onAdvance } = setup('result');
    finishTyping();
    expect(shown()).toEqual(['けいけんち 3']);
    fireEvent.click(layer()!);
    expect(onAdvance).toHaveBeenCalledOnce();
  });
});
