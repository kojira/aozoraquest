/**
 * world.monsters の小数を文字列で保存する (#740)。AT Protocol のレコードは整数以外の数値を持てない。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeMonsters, decodeMonstersFromRecord, encodeMonstersForRecord, loadAdminWorld, MONSTERS, MONSTERS_BY_ID,
  setMonsterOverrides, type MonsterDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

/** レコードに残る整数以外の数値の場所。 */
function nonIntegerPaths(v: unknown, path = ''): string[] {
  if (typeof v === 'number') return Number.isInteger(v) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => nonIntegerPaths(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => nonIntegerPaths(x, `${path}.${k}`));
  return [];
}

describe('monsters レコードの小数 (#740)', () => {
  afterEach(() => setMonsterOverrides(TEST_MONSTERS));

  it('同梱の全モンスターを書く形にすると整数以外の数値が残らず、読み戻すと元と同じ', () => {
    const roster = MONSTERS.map((m) => ({ ...m }));
    expect(nonIntegerPaths(roster).length).toBeGreaterThan(0);
    const encoded = encodeMonstersForRecord(roster);
    expect(nonIntegerPaths(encoded)).toEqual([]);
    expect(decodeMonstersFromRecord(encoded)).toEqual(roster);
  });

  it('エディタで設定できる healRatio / abilityParams も文字列になる', () => {
    const m: MonsterDef = { ...MONSTERS[0]!, healRatio: 0.25, abilityParams: { chargeChance: 0.4, fleeBase: 0.35 } };
    const [e] = encodeMonstersForRecord([m]) as Array<Record<string, unknown>>;
    expect(e!.healRatio).toBe('0.25');
    expect(e!.abilityParams).toEqual({ chargeChance: '0.4', fleeBase: '0.35' });
    expect(nonIntegerPaths(e)).toEqual([]);
  });

  it('数値にできない文字列は読み込みで弾く', () => {
    const [e] = encodeMonstersForRecord([MONSTERS[0]!]) as Array<Record<string, unknown>>;
    expect(() => decodeMonstersFromRecord([{ ...e, spawnWeight: 'abc' }])).toThrow(/spawnWeight/);
  });

  it('loadAdminWorld は文字列で保存したレコードを数値に戻して適用する (chance "0.3" → 0.3)', async () => {
    const roster = MONSTERS.map((m) => ({ ...m }));
    const target = roster.find((m) => m.drops.length > 0)!;
    const edited = roster.map((m) => (m.id === target.id ? { ...m, drops: [{ ...m.drops[0]!, chance: 0.3 }], spawnWeight: 0.4 } : m));
    const record = { monsters: encodeMonstersForRecord(edited) };
    expect((record.monsters.find((m) => (m as MonsterDef).id === target.id) as { drops: Array<{ chance: unknown }> }).drops[0]!.chance).toBe('0.3');
    const errors: string[] = [];
    await loadAdminWorld(async (name) => (name === 'monsters' ? record : null), (name, e) => errors.push(`${name}: ${String(e)}`));
    expect(errors).toEqual([]);
    expect(MONSTERS_BY_ID[target.id]!.drops[0]!.chance).toBe(0.3);
    expect(MONSTERS_BY_ID[target.id]!.spawnWeight).toBe(0.4);
    expect(activeMonsters().length).toBe(roster.length);
  });
});
