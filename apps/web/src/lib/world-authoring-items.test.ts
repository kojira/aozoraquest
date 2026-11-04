/**
 * saveItems (D-ITEM-001): どうぐの効果の小数を文字列で書く (AT Protocol のレコードは整数以外の数値を持てない。monsters #740 と同じ)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import { ITEMS, activeEquipment, activeItems, setItemOverrides, type ItemDefData } from '@aozoraquest/core';

const putRecord = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({})));
vi.mock('./atproto', () => ({ getRecord: vi.fn(), putRecord }));

import { saveItems } from './world-authoring';

describe('saveItems', () => {
  afterEach(() => { setItemOverrides(null); putRecord.mockClear(); });

  it('効果の小数は文字列で書き、ゲーム側の ITEMS は数値のまま', async () => {
    const nemuri: ItemDefData = { id: 'nemuri-kona', name: 'ねむりごな', battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', chance: 0.7, turns: 3 }] } };
    await saveItems({} as Agent, [...activeItems(), nemuri], [...activeEquipment()]);
    const rec = putRecord.mock.calls[0]![3] as { items: ItemDefData[] };
    const floats: number[] = [];
    JSON.stringify(rec, (_k, v: unknown) => { if (typeof v === 'number' && !Number.isInteger(v)) floats.push(v); return v; });
    expect(floats).toEqual([]);
    expect(rec.items.find((x) => x.id === 'nemuri-kona')!.battle!.effects[0]).toMatchObject({ chance: '0.7', turns: 3 });
    expect(ITEMS['nemuri-kona']?.battle?.effects[0]).toMatchObject({ chance: 0.7 });
  });
});
