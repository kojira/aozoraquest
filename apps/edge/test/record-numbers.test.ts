/** 権威の記録の小数を文字列で持つ (#998)。書いて読むと元と同じ値に戻り、記録には整数以外の数値が残らない。 */
import { describe, expect, it } from 'vitest';
import { decodeRecordNumbers, encodeRecordNumbers } from '../src/record-numbers';

const nonIntegers = (v: unknown): number[] => typeof v === 'number' ? (Number.isInteger(v) ? [] : [v]) : Array.isArray(v) ? v.flatMap(nonIntegers) : v && typeof v === 'object' ? Object.values(v).flatMap(nonIntegers) : [];

describe('encodeRecordNumbers / decodeRecordNumbers', () => {
  const value = {
    turn: 3, hp: -2, armorDye: { water: 0.5, fire: 0.1 + 0.2 }, tiny: 1e-7, big: 12345.678901234567, neg: -0.25,
    statuses: [{ id: 'atkDown', magnitude: 0.75 }], name: '~n:0.5', tilde: '~~x', plain: 'ふつう', ok: true, none: null,
  };

  it('整数以外の数値は文字列になり、読むと同じ値 (Object.is で一致) に戻る', () => {
    const rec = encodeRecordNumbers(value);
    expect(nonIntegers(rec)).toEqual([]);
    expect(rec.armorDye.water).toBe('~n:0.5');
    expect(decodeRecordNumbers(rec)).toEqual(value);
    expect(Object.is(decodeRecordNumbers(rec).armorDye.fire, 0.1 + 0.2)).toBe(true);
  });

  it('~ で始まる文字列は数値に化けない (名前などがたまたま印の形でも)', () => {
    const rec = encodeRecordNumbers(value);
    expect(rec.name).toBe('~~n:0.5');
    expect(decodeRecordNumbers(rec).name).toBe('~n:0.5');
    expect(decodeRecordNumbers(rec).tilde).toBe('~~x');
  });

  it('印の無い記録 (これより前に書いたもの) はそのまま読める', () => {
    const old = { turn: 1, gear: ['a'], materials: { herb: 2 }, name: 'たびびと' };
    expect(decodeRecordNumbers(old)).toEqual(old);
  });
});
