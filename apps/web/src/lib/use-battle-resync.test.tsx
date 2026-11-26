// @vitest-environment jsdom
/**
 * 戦闘の読み直し (#1006)。スマホでブラウザを裏に回すと、ターンの答えが画面に届かないまま
 * サーバーではターンが進む。古い番号で送り続けて 409 (「ターンがずれた」) から抜けられなかった。
 * - 409 を受けたらサーバーのいまの戦闘を読み、その番号の入力にもどる。次のコマンドは新しい番号で送る
 * - 画面が前に戻ったら (入力待ちなら) 一度読み直す
 * - 戦闘が無ければ (決着ずみ) 戦闘を閉じ、権威 state の HP・位置・在庫を写す。報酬は足さない
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Agent } from '@atproto/api';
import type { BattleState } from '@aozoraquest/core';

const turn = vi.hoisted(() => vi.fn());
const current = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => vi.fn());
vi.mock('@/lib/world-server', async (orig) => ({ ...(await orig<typeof import('@/lib/world-server')>()), serverTurn: turn, serverBattleCurrent: current, serverState: state }));

import { WorldServerError } from '@/lib/world-server';
import { useWorldBattle, type WorldBattle } from './use-world-battle';
import { useWorldInventory } from './use-world-inventory';
import { BATTLE_ALREADY_OVER } from './use-battle-resync';
import type { Vitals } from './world-view';

const bs = (t: number, hp = 30): BattleState => ({ turn: t, outcome: 'ongoing', player: { name: 'p', hp, maxHp: 40, mp: 5, maxMp: 5 }, monster: { name: 'm', hp: 9, maxHp: 9 }, lastEvents: [] } as unknown as BattleState);
const WS: Vitals = { x: 1, y: 1, hp: 20, mp: 3, lastTown: null, regions: [], visitedTowns: [], gotStarterFeather: true };

function setup() {
  let ws: Vitals | null = WS;
  const notices: Array<string | null> = [];
  const setServerPower = vi.fn();
  const hook = renderHook(() => {
    const inventory = useWorldInventory();
    const b = useWorldBattle({
      agent: {} as Agent, setQuest: () => {}, flagsRef: { current: [] }, pendingNoticesRef: { current: [] }, flushScenarioNotices: () => {},
      tokenRef: { current: undefined }, setWs: (f) => { ws = typeof f === 'function' ? f(ws) : f; }, setNotice: (n) => { notices.push(n); },
      scheduleSave: () => {}, inventory, setServerPower, archetypeRef: { current: null }, didRef: { current: null }, onPieces: () => {},
    });
    return { inventory, b };
  });
  const start = (t: number) => act(() => {
    const battle: WorldBattle = { battleId: 'b1', state: bs(t), busy: false, phase: 'input' };
    hook.result.current.b.battleRef.current = battle;
    hook.result.current.b.setBattle(battle);
  });
  return { hook, start, notices, setServerPower, ws: () => ws };
}

describe('戦闘の読み直し (#1006)', () => {
  afterEach(() => { turn.mockReset(); current.mockReset(); state.mockReset(); });

  it('409 を受けたらサーバーのいまの番号の入力にもどり、次のコマンドはその番号で送る', async () => {
    const { hook, start } = setup();
    await start(3);
    turn.mockRejectedValueOnce(new WorldServerError('ターン不一致', 409, 'battle_error'));
    current.mockResolvedValue({ battle: { battleId: 'b1', turn: 4, state: bs(4, 12) } });
    await act(async () => { hook.result.current.b.onBattleCommand('skill', 1); });
    await waitFor(() => expect(hook.result.current.b.battle?.state.turn).toBe(4));
    const b = hook.result.current.b.battle!;
    expect(b).toMatchObject({ phase: 'input', busy: false });
    expect(b.errorText).toBeUndefined();
    expect(b.state.player.hp).toBe(12);
    turn.mockResolvedValueOnce({ state: bs(5), events: [], outcome: 'ongoing' });
    await act(async () => { hook.result.current.b.onBattleCommand('attack'); });
    expect(turn).toHaveBeenLastCalledWith(expect.anything(), 'b1', 4, 'attack', undefined, undefined, undefined, undefined);
  });

  it('画面が前に戻ったら (入力待ちなら) 押す前に読み直す', async () => {
    const { hook, start } = setup();
    await start(2);
    current.mockResolvedValue({ battle: { battleId: 'b1', turn: 3, state: bs(3) } });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(hook.result.current.b.battle?.state.turn).toBe(3));
    expect(current).toHaveBeenCalledOnce();
  });

  it('戦闘が無ければ (決着ずみ) 閉じて、権威 state の HP・位置・在庫・パワーを写す。報酬は足さない', async () => {
    const { hook, start, notices, setServerPower, ws } = setup();
    await start(5);
    turn.mockRejectedValueOnce(new WorldServerError('戦闘中でない', 409, 'battle_error'));
    current.mockResolvedValue({ battle: null });
    state.mockResolvedValue({ state: { x: 7, y: 8, carryHp: 11, materials: { herb: 2 }, power: 4, activeQuests: [] }, initialized: true, token: 'tk' });
    await act(async () => { hook.result.current.b.onBattleCommand('attack'); });
    await waitFor(() => expect(state).toHaveBeenCalledOnce());
    await waitFor(() => expect(hook.result.current.inventory.herbStock).toBe(2));
    expect(hook.result.current.b.battle).toBeNull();
    expect(notices).toContain(BATTLE_ALREADY_OVER);
    expect(ws()).toMatchObject({ x: 7, y: 8, hp: 11, mp: null });
    expect(setServerPower).toHaveBeenCalledWith(4);
    expect(hook.result.current.b.battleRef.current).toBeNull();
  });
});
