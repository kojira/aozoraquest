// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { activeEquipment, activeItems, setItemOverrides, type BattleState } from '@aozoraquest/core';
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

describe('WorldBattleControls 戦闘のどうぐ (D-ITEM-001)', () => {
  const NEMURI = { id: 'nemuri-kona', name: 'ねむりごな', battle: { effects: [{ kind: 'status' as const, status: 'sleep' as const, target: 'enemy' as const, chance: 0.7, turns: 3 }] } };
  beforeEach(() => setItemOverrides({ items: [...activeItems(), NEMURI], equipment: [...activeEquipment()] }));
  afterEach(() => setItemOverrides(null));
  const withItems = (battleItems: Record<string, number>, enemies = 1): BattleState => {
    const s = state();
    const extra = enemies > 1 ? { allies: [s.player], enemies: [s.monster, fighter('スライムB', 10)] } : {};
    return { ...s, battleItems, ...extra } as BattleState;
  };
  const openItems = (s: BattleState, onCommand = vi.fn()) => {
    render(<WorldBattleControls state={s} phase="input" busy={false} showEnemyVitals={false} resultLines={[]} onCommand={onCommand} onAdvance={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'どうぐ' }));
    return onCommand;
  };

  it('どうぐの行が「名前 ×N」で並び、押すと item と itemId を送る', () => {
    const onCommand = openItems(withItems({ 'nemuri-kona': 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'ねむりごな ×2' }));
    expect(onCommand).toHaveBeenCalledWith('item', undefined, 'nemuri-kona');
  });
  it('やくそう・しずくが 0 でも、戦闘用のどうぐがあれば「どうぐ」を押せる', () => {
    render(<WorldBattleControls state={withItems({ 'nemuri-kona': 1 })} phase="input" busy={false} showEnemyVitals={false} resultLines={[]} onCommand={vi.fn()} onAdvance={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'どうぐ' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('0 個のどうぐは出さない (何もなければ「どうぐ」は押せない)', () => {
    render(<WorldBattleControls state={withItems({ 'nemuri-kona': 0 })} phase="input" busy={false} showEnemyVitals={false} resultLines={[]} onCommand={vi.fn()} onAdvance={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'どうぐ' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /ねむりごな/ })).toBeNull();
  });
  it('敵が 2 体でも、ねらう相手の選択はまだ出さずにそのまま送る (1 体目に使う)', () => {
    const onCommand = openItems(withItems({ 'nemuri-kona': 1 }, 2));
    fireEvent.click(screen.getByRole('button', { name: 'ねむりごな ×1' }));
    expect(onCommand).toHaveBeenCalledWith('item', undefined, 'nemuri-kona');
    expect(screen.queryByText('だれを ねらう？')).toBeNull();
  });
});

describe('WorldBattleControls パーティと群れ (D-PARTY-001)', () => {
  const group = (enemyHps: number[], allyHps: number[] = [20]): BattleState => {
    const s = state();
    const enemies = enemyHps.map((hp, i) => fighter(['スライムA', 'スライムB', 'スライムC'][i]!, hp));
    const allies = allyHps.map((hp, i) => fighter(['ゆうしゃ', 'カイト', 'ミオ'][i]!, hp));
    return { ...s, player: allies[0]!, monster: enemies[0]!, allies, enemies, playerSkills: [{ name: 'わざ', kind: 'smash' }, { name: 'かまえ', kind: 'warrior-charge' }] } as unknown as BattleState;
  };
  const input = (s: BattleState, onCommand = vi.fn()) => {
    render(<WorldBattleControls state={s} phase="input" busy={false} showEnemyVitals={false} resultLines={[]} onCommand={onCommand} onAdvance={vi.fn()} />);
    return onCommand;
  };

  it('敵 3 体を名前つきで並べ、倒れた敵は薄くする', () => {
    input(group([10, 0, 7]));
    for (const n of ['スライムA', 'スライムB', 'スライムC']) expect(screen.getByText(n)).toBeTruthy();
    expect(screen.getByText('スライムB').closest<HTMLElement>('[data-enemy]')!.style.opacity).toBe('0.35');
    expect(screen.getByText('スライムA').closest<HTMLElement>('[data-enemy]')!.style.opacity).toBe('1');
  });

  it('生きている敵が 2 体以上なら「たたかう」でねらう相手を選び、生きている敵の中の番号を送る', () => {
    const onCommand = input(group([10, 0, 7]));
    fireEvent.click(screen.getByRole('button', { name: 'たたかう' }));
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByText('だれを ねらう？')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'スライムB' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'スライムC' }));
    expect(onCommand).toHaveBeenCalledWith('attack', undefined, undefined, 1);
  });

  it('単体ねらいのとくぎだけ選ぶ。自分にかけるとくぎはそのまま送る', () => {
    const onCommand = input(group([10, 7]));
    fireEvent.click(screen.getByRole('button', { name: 'かまえ' }));
    expect(onCommand).toHaveBeenCalledWith('skill', 1);
    fireEvent.click(screen.getByRole('button', { name: 'わざ' }));
    fireEvent.click(screen.getByRole('button', { name: 'スライムA' }));
    expect(onCommand).toHaveBeenLastCalledWith('skill', 0, undefined, 0);
  });

  it('生きている敵が 1 体なら選ばずに送る', () => {
    const onCommand = input(group([0, 7]));
    fireEvent.click(screen.getByRole('button', { name: 'たたかう' }));
    expect(onCommand).toHaveBeenCalledWith('attack');
  });

  it('仲間がいれば味方の段に 1 人 1 行で HP/MP を出し、倒れた仲間は薄くする', () => {
    input(group([10], [20, 13, 0]));
    const row = (n: string) => screen.getAllByText(n).map((e) => e.closest<HTMLElement>('[data-ally]')).find(Boolean)!;
    expect(row('カイト').textContent).toContain('HP 13/30');
    expect(row('カイト').textContent).toContain('MP 5/5');
    expect(row('ミオ').style.opacity).toBe('0.4');
    expect(row('ゆうしゃ').style.opacity).toBe('1');
  });

  it('1 人なら味方の段を出さない', () => {
    input(group([10, 7]));
    expect(document.querySelector('[data-ally]')).toBeNull();
  });
});
