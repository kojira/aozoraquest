/**
 * world.items の小数を文字列で保存する (D-ITEM-001。monsters の #740 と同じ)。AT Protocol のレコードは整数以外の数値を持てない。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ITEMS, activeEquipment, activeItems, decodeItemsFromRecord, encodeItemsForRecord, loadAdminWorld, setItemOverrides, type ItemDefData,
} from '../index.js';

function nonIntegerPaths(v: unknown, path = ''): string[] {
  if (typeof v === 'number') return Number.isInteger(v) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => nonIntegerPaths(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => nonIntegerPaths(x, `${path}.${k}`));
  return [];
}

const NEMURI: ItemDefData = {
  id: 'nemuri-kona', name: 'ねむりごな', price: { power: 3, materials: 1 }, shopTier: 1,
  battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', chance: 0.7, turns: 3, magnitude: 1.5 }, { kind: 'heal', ratio: 0.25 }] },
};

describe('items レコードの小数 (D-ITEM-001)', () => {
  afterEach(() => setItemOverrides(null));

  it('書く形にすると整数以外の数値が残らず、読み戻すと元と同じ', () => {
    const items = [...activeItems(), NEMURI];
    expect(nonIntegerPaths(items).length).toBeGreaterThan(0);
    const encoded = encodeItemsForRecord(items);
    expect(nonIntegerPaths(encoded)).toEqual([]);
    expect((encoded.at(-1) as ItemDefData).battle!.effects[0]).toMatchObject({ chance: '0.7', turns: 3, magnitude: '1.5' });
    expect(decodeItemsFromRecord(encoded)).toEqual(items);
  });

  it('数値にできない文字列は読み込みで弾く', () => {
    const [e] = encodeItemsForRecord([NEMURI]) as ItemDefData[];
    const bad = { ...e!, battle: { effects: [{ ...e!.battle!.effects[0]!, chance: 'abc' }] } };
    expect(() => decodeItemsFromRecord([bad])).toThrow(/chance/);
  });

  it('文字列で保存した items レコードを読み込みで数値に戻す', async () => {
    const value = { items: encodeItemsForRecord([...activeItems(), NEMURI]), equipment: [...activeEquipment()] };
    await loadAdminWorld(async (n) => (n === 'items' ? value : null) as never, (n, e) => { throw new Error(`${n}: ${e}`); });
    expect(ITEMS['nemuri-kona']?.battle?.effects[0]).toMatchObject({ chance: 0.7, magnitude: 1.5 });
  });
});
