import { describe, expect, test } from 'vitest';
import { buildRopeTables, packSequences, planBatches, softmax } from './packing';

describe('packSequences', () => {
  test('系列を連結し、トークンごとに {id, 系列先頭, 系列長, 系列内位置} を持つ', () => {
    const p = packSequences([[1, 10, 2], [1, 20, 21, 2]], 16, 4);
    expect(p.tokens).toBe(7);
    expect(Array.from(p.seqStart)).toEqual([0, 3]);
    const rows = Array.from({ length: 7 }, (_, t) => Array.from(p.meta.subarray(t * 4, t * 4 + 4)));
    expect(rows[1]).toEqual([10, 0, 3, 1]);
    expect(rows[3]).toEqual([1, 3, 4, 0]);
    expect(rows[6]).toEqual([2, 3, 4, 3]);
  });

  test('容量超過・空系列は throw', () => {
    expect(() => packSequences([[1, 2, 3]], 2, 4)).toThrow();
    expect(() => packSequences([[1], [2]], 8, 1)).toThrow();
    expect(() => packSequences([[]], 8, 4)).toThrow();
  });
});

describe('planBatches', () => {
  test('順序を保ってトークン数・系列数の上限で区切る', () => {
    expect(planBatches([5, 5, 5, 2], 10, 8)).toEqual([[0, 1], [2, 3]]);
    expect(planBatches([1, 1, 1], 100, 2)).toEqual([[0, 1], [2]]);
  });

  test('1 系列が上限を超えたら throw (呼び出し側で切り詰める前提)', () => {
    expect(() => planBatches([11], 10, 8)).toThrow();
  });
});

describe('buildRopeTables', () => {
  test('HF ModernBERT と同じ inv_freq = theta^(-2i/d) で角度を作る', () => {
    const { cos, sin } = buildRopeTables(4, 64, 10000);
    expect(cos[0]).toBe(1);
    expect(sin[0]).toBe(0);
    // pos=3, i=0: angle=3
    expect(cos[3 * 32]).toBeCloseTo(Math.cos(3), 6);
    // pos=2, i=16: inv_freq = 10000^(-0.5) = 0.01
    expect(sin[2 * 32 + 16]).toBeCloseTo(Math.sin(0.02), 6);
  });
});

describe('softmax', () => {
  test('大きな logits でも溢れず和が 1', () => {
    const p = softmax([1000, 1000, 998]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(p[0]).toBeCloseTo(p[1]!, 12);
    expect(p[2]).toBeLessThan(p[0]!);
  });
});
