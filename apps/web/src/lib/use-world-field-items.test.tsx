// @vitest-environment jsdom
/**
 * しらべる (D-CHEST-001 §5・§6): 無料のマスではパワー 0 でも止めずに edge へ送り、
 * 応答の文言・openedSpots・装備の個体を写す。有料のマスはパワー不足で止める。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Agent } from '@atproto/api';
import { setStory } from '@aozoraquest/core';

const search = vi.hoisted(() => vi.fn());
vi.mock('@/lib/world-server', async (orig) => ({ ...(await orig<typeof import('@/lib/world-server')>()), serverSearch: search }));

import { useWorldFieldItems } from './use-world-field-items';
import { useWorldInventory } from './use-world-inventory';

function setup(at: { mapId: string; x: number; y: number }) {
  const msgs: Array<string | null> = [];
  const setCraftedPieces = vi.fn();
  const hook = renderHook(() => {
    const inventory = useWorldInventory();
    const items = useWorldFieldItems({
      agent: {} as Agent, did: 'did:test', combat: null, inventory,
      wsRef: { current: { ...at, hp: null, mp: null, lastTown: null, regions: [], visitedTowns: [], gotStarterFeather: true } },
      setWs: () => {}, setNotice: () => {}, scheduleSave: () => {}, moveBusyRef: { current: false }, tokenRef: { current: undefined },
      flagsRef: { current: [] }, pendingNoticesRef: { current: [] }, serverPowerRef: { current: 0 }, setServerPower: () => {},
      setSearchMsg: (m) => { msgs.push(typeof m === 'function' ? null : m); }, setFeatherOpen: () => {}, setWipe: () => {},
      fieldItemBlocked: () => false, setCraftedPieces,
    });
    return { inventory, items };
  });
  return { hook, msgs, setCraftedPieces };
}

describe('useWorldFieldItems の しらべる (宝箱・キラキラ)', () => {
  beforeEach(() => setStory({ placedItems: [{ id: 'c1', mapId: 'v', x: 1, y: 1, kind: 'chest', rewards: [{ equipment: 'wp-knife' }] }] }));
  afterEach(() => { setStory(null); search.mockReset(); });

  it('宝箱のマスはパワー 0 でも止めず、文言・openedSpots・個体を写す', async () => {
    search.mockResolvedValue({ found: null, materials: {}, power: 0, placed: { kind: 'chest', rewards: [{ equipment: 'wp-knife' }] }, openedSpots: ['c1'], pieces: [{ rkey: 'chest-c1', itemId: 'wp-knife', level: 0 }] });
    const { hook, msgs, setCraftedPieces } = setup({ mapId: 'v', x: 1, y: 1 });
    await act(() => hook.result.current.items.searchHere());
    expect(search).toHaveBeenCalledOnce();
    expect(msgs.at(-1)).toBe('宝箱を開けた！ ナイフを手に入れた！（そうびで確認）');
    expect(hook.result.current.inventory.openedRef.current).toEqual(['c1']);
    expect(setCraftedPieces).toHaveBeenCalledWith([{ rkey: 'chest-c1', itemId: 'wp-knife', level: 0, at: '' }]);
  });

  it('開封済みの宝箱もパワー 0 で送り「からっぽだ。」。置きアイテムの無いマスはパワー不足で止める', async () => {
    search.mockResolvedValue({ found: null, materials: {}, power: 0, placedState: 'empty' });
    const { hook, msgs } = setup({ mapId: 'v', x: 1, y: 1 });
    hook.result.current.inventory.openedRef.current = ['c1'];
    await act(() => hook.result.current.items.searchHere());
    expect(msgs.at(-1)).toBe('からっぽだ。');
    const other = setup({ mapId: 'v', x: 5, y: 5 });
    await act(() => other.hook.result.current.items.searchHere());
    expect(search).toHaveBeenCalledOnce();
    expect(other.msgs.at(-1)).toMatch(/^パワーが足りない/);
  });
});
