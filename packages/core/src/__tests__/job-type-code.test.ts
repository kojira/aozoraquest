import { describe, expect, test } from 'vitest';
import { JOBS, jobTypeCode } from '../jobs.js';
import type { CogFunction } from '../types.js';

describe('jobTypeCode', () => {
  test.each([
    ['sage', 'INTJ'], ['mage', 'INTP'], ['shogun', 'ENTJ'], ['bard', 'ENTP'],
    ['seer', 'INFJ'], ['poet', 'INFP'], ['paladin', 'ENFJ'], ['explorer', 'ENFP'],
    ['warrior', 'ISTJ'], ['guardian', 'ISFJ'], ['fighter', 'ISTP'], ['artist', 'ISFP'],
    ['captain', 'ESTJ'], ['miko', 'ESFJ'], ['ninja', 'ESTP'], ['performer', 'ESFP'],
  ])('%s → %s', (id, code) => {
    expect(jobTypeCode(id)).toBe(code);
  });

  test('未知 ID は null', () => {
    expect(jobTypeCode('wanderer')).toBeNull();
    expect(jobTypeCode('')).toBeNull();
  });

  /** dom/aux 認知機能から 4 文字型を導出する (Ni-Te → INTJ など)。 */
  function codeFromFunctions(dom: CogFunction, aux: CogFunction): string {
    const ei = dom[1] === 'e' ? 'E' : 'I';
    const perceiving = (f: CogFunction) => f[0] === 'N' || f[0] === 'S';
    const p = perceiving(dom) ? dom : aux;
    const j = perceiving(dom) ? aux : dom;
    // 外向側の機能が判断機能なら J、知覚機能なら P
    const extraverted = dom[1] === 'e' ? dom : aux;
    const jp = perceiving(extraverted) ? 'P' : 'J';
    return `${ei}${p[0]}${j[0]}${jp}`;
  }

  test('全 16 ジョブで dominantFunction/auxiliaryFunction と一致する', () => {
    expect(JOBS).toHaveLength(16);
    for (const job of JOBS) {
      expect(jobTypeCode(job.id), job.id).toBe(codeFromFunctions(job.dominantFunction, job.auxiliaryFunction));
    }
  });
});
