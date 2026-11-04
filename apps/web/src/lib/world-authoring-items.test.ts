/**
 * saveItems (D-ITEM-001): どうぐの効果の小数を文字列で書く (AT Protocol のレコードは整数以外の数値を持てない。monsters #740 と同じ)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import { ITEMS, activeEquipment, activeItems, setItemOverrides, type ItemDefData } from '@aozoraquest/core';

const putRecord = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({})));
const getRecord = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown> => null));
vi.mock('./atproto', () => ({ getRecord, putRecord }));

import { loadAuthoredWorld, saveItems } from './world-authoring';
import { ADMIN_COL } from './collections';

describe('saveItems', () => {
  afterEach(() => { setItemOverrides(null); putRecord.mockClear(); getRecord.mockReset(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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

  it('保存したレコードを読み込み直すと、小数・値段・tier・説明が保存前と同じ値に戻る (#863)', async () => {
    vi.stubEnv('VITE_ADMIN_DIDS', 'did:plc:itemadmin');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const nemuri: ItemDefData = {
      id: 'nemuri-kona', name: 'ねむりごな', desc: '敵 1 体を眠らせる', price: { power: 3, materials: 1 }, shopTier: 1,
      battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', chance: 0.7, turns: 3, magnitude: 1.5 }, { kind: 'heal', ratio: 0.25 }] },
    };
    const items = [...activeItems(), nemuri];
    await saveItems({} as Agent, items, [...activeEquipment()]);
    const saved = JSON.parse(JSON.stringify(putRecord.mock.calls[0]![3])) as unknown;
    setItemOverrides(null);
    expect(ITEMS['nemuri-kona']).toBeUndefined();
    getRecord.mockImplementation(async (_agent, _repo, collection) => (collection === ADMIN_COL.items ? saved : null));
    await loadAuthoredWorld({} as Agent);
    expect(activeItems()).toEqual(items);
  });
});
