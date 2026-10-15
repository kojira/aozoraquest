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

describe('WorldBattleControls 行ごとの HP (#764)', () => {
  const hpState = (): BattleState => ({
    ...state(),
    player: fighter('ゆうしゃ', 12), monster: fighter('スライム', 25),
    lastEvents: [
      { actor: 'player', text: 'ゆうしゃのこうげき! スライムに 5 のダメージ', damage: 5, hp: { player: 20, monsters: [25] } },
      { actor: 'monster', text: 'スライムのこうげき! ゆうしゃに 8 のダメージ', damage: 8, hp: { player: 12, monsters: [25] } },
      { actor: 'monster', text: 'スライムは ねむっている…', hp: { player: 12, monsters: [25] } },
    ],
  }) as unknown as BattleState;
  const prev = (): BattleState => ({ ...state(0), player: fighter('ゆうしゃ', 20), monster: fighter('スライム', 30) }) as unknown as BattleState;
  const enemyHp = () => screen.getByText(/\/ 30$/).textContent;

  it('ダメージの 行で 自分の HP と 敵の HP が その時点の 値に なり、そこで 揺れる', () => {
    const onLineHp = vi.fn();
    render(<WorldBattleControls state={hpState()} prevState={prev()} phase="message" busy={false} showEnemyVitals resultLines={[]} onCommand={vi.fn()} onAdvance={vi.fn()} onLineHp={onLineHp} />);
    const step = () => { finishTyping(); fireEvent.click(layer()!); finishTyping(); };
    const sprite = () => document.querySelector('svg')!.parentElement!;
    finishTyping();
    // 1 行目「ゆうしゃのこうげき!」: まだ 前の HP
    expect(enemyHp()).toBe('30 / 30');
    expect(onLineHp).toHaveBeenLastCalledWith(1, 20, false);
    expect(sprite().className).toBe('');
    step(); // 2 行目「スライムに 5 のダメージ」: 敵だけ 減って 揺れる
    expect(enemyHp()).toBe('25 / 30');
    expect(sprite().className).toBe('trial-hit');
    expect(onLineHp).toHaveBeenLastCalledWith(1, 20, false);
    step(); // 3 行目「スライムのこうげき!」: まだ 自分は 減らない
    expect(onLineHp).toHaveBeenLastCalledWith(1, 20, false);
    expect(sprite().className).toBe('');
    step(); // 4 行目「ゆうしゃに 8 のダメージ」: 自分が 減って 揺れる
    expect(onLineHp).toHaveBeenLastCalledWith(1, 12, true);
    step(); // 最後の 行: 最終 state
    expect(onLineHp).toHaveBeenLastCalledWith(1, 12, false);
    expect(enemyHp()).toBe('25 / 30');
  });
  it('hp の 無い 旧応答は 最後の 行で はじめて 最終値 (#757 の 挙動)', () => {
    const onLineHp = vi.fn();
    const old = { ...hpState(), lastEvents: hpState().lastEvents.map(({ hp: _hp, ...e }) => e) } as BattleState;
    render(<WorldBattleControls state={old} prevState={prev()} phase="message" busy={false} showEnemyVitals resultLines={[]} onCommand={vi.fn()} onAdvance={vi.fn()} onLineHp={onLineHp} />);
    finishTyping();
    for (let i = 0; i < 3; i++) { fireEvent.click(layer()!); finishTyping(); }
    expect(enemyHp()).toBe('30 / 30');
    expect(onLineHp).toHaveBeenLastCalledWith(1, 20, false);
    fireEvent.click(layer()!); finishTyping();
    expect(enemyHp()).toBe('25 / 30');
    expect(onLineHp).toHaveBeenLastCalledWith(1, 12, true);
  });
});
