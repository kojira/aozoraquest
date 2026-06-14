import { describe, expect, test } from 'vitest';
import { JOBS, archetypeFromFunctionPair, currentJob, jobDisplayName, shapeSimilarity, wandererScore } from '../jobs.js';
import { COGNITIVE_TO_RPG } from '../diagnosis.js';
import { STATS, type CogFunction, type StatArray } from '../types.js';

/** scripts/gen-job-stats.ts と同じ式で dom/aux からジョブ stats を再導出する。 */
function expectedStats(dom: CogFunction, aux: CogFunction): number[] {
  const FLIP_L: Record<string, string> = { N: 'S', S: 'N', T: 'F', F: 'T' };
  const FLIP_A: Record<string, string> = { i: 'e', e: 'i' };
  const flip = (f: CogFunction) => (FLIP_L[f[0]!]! + FLIP_A[f[1]!]!) as CogFunction;
  const stack: Partial<Record<CogFunction, number>> = { [dom]: 1.0, [aux]: 0.5, [flip(aux)]: 0.25, [flip(dom)]: 0.125 };
  const raw: Record<string, number> = Object.fromEntries(STATS.map((s) => [s, 0]));
  for (const [fn, w] of Object.entries(stack)) for (const s of STATS) raw[s]! += (w as number) * COGNITIVE_TO_RPG[fn as CogFunction][s];
  const tot = STATS.reduce((a, s) => a + raw[s]!, 0);
  const floored = STATS.map((s) => 6 + 0.7 * ((raw[s]! / tot) * 100)); // floor + affine
  const base = floored.map(Math.floor);
  const rem = 100 - base.reduce((a, b) => a + b, 0);
  const order = floored.map((v, i) => ({ frac: v - Math.floor(v), i })).sort((a, b) => b.frac - a.frac).map((x) => x.i);
  for (let k = 0; k < rem; k++) base[order[k]!] = base[order[k]!]! + 1;
  return base;
}

describe('JOBS', () => {
  test('has 16 entries', () => {
    expect(JOBS.length).toBe(16);
  });

  test('all stats sum to 100', () => {
    for (const j of JOBS) {
      const sum = j.stats.reduce((a, b) => a + b, 0);
      expect(sum, `${j.id} stats sum`).toBe(100);
    }
  });

  test('stats は認知機能スタックの floor 付き理論値と一致 (gen-job-stats.ts と同式・ドリフト検出)', () => {
    for (const j of JOBS) {
      expect([...j.stats], `${j.id} stats`).toEqual(expectedStats(j.dominantFunction, j.auxiliaryFunction));
    }
  });

  test('all ids are unique and lowercase', () => {
    const ids = JOBS.map(j => j.id);
    expect(new Set(ids).size).toBe(16);
    for (const id of ids) expect(id).toBe(id.toLowerCase());
  });
});

describe('shapeSimilarity', () => {
  test('identical stats → 1.0', () => {
    const v: StatArray = [20, 25, 15, 30, 10];
    expect(shapeSimilarity(v, v)).toBeCloseTo(1.0);
  });

  test('flat vector similarity is 0', () => {
    const flat: StatArray = [20, 20, 20, 20, 20];
    const peaked: StatArray = [40, 10, 10, 30, 10];
    expect(Math.abs(shapeSimilarity(flat, peaked))).toBeLessThan(0.01);
  });

  test('returns in [-1, 1]', () => {
    for (const j1 of JOBS) for (const j2 of JOBS) {
      const s = shapeSimilarity(j1.stats, j2.stats);
      expect(s).toBeGreaterThanOrEqual(-1.001);
      expect(s).toBeLessThanOrEqual(1.001);
    }
  });
});

describe('currentJob', () => {
  test('exact sage stats → sage match', () => {
    const sageStats: StatArray = [22, 15, 9, 40, 14];
    const result = currentJob(sageStats);
    expect(result).not.toBeNull();
    expect(result!.jobId).toBe('sage');
    expect(result!.score).toBeCloseTo(1.0);
  });

  test('flat stats → null (wanderer)', () => {
    expect(currentJob([20, 20, 20, 20, 20])).toBeNull();
  });
});

describe('wandererScore', () => {
  test('flat vector → 1.0', () => {
    expect(wandererScore([20, 20, 20, 20, 20])).toBeCloseTo(1.0);
  });

  test('peaked → lower', () => {
    const flat = wandererScore([20, 20, 20, 20, 20]);
    const peaked = wandererScore([80, 5, 5, 5, 5]);
    expect(peaked).toBeLessThan(flat);
  });
});

describe('archetypeFromFunctionPair', () => {
  test('Ni-Te → sage', () => {
    expect(archetypeFromFunctionPair('Ni', 'Te')).toBe('sage');
  });
  test('Fe-Si → miko', () => {
    expect(archetypeFromFunctionPair('Fe', 'Si')).toBe('miko');
  });
  test('invalid pair (Ni-Se) → null', () => {
    expect(archetypeFromFunctionPair('Ni', 'Se')).toBeNull();
  });
});

describe('jobDisplayName', () => {
  test('returns different names per variant', () => {
    expect(jobDisplayName('sage', 'default')).toBe('賢者');
    expect(jobDisplayName('sage', 'maker')).toBe('建築家');
    expect(jobDisplayName('sage', 'alt')).toBe('戦略家');
  });
});
