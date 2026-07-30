/**
 * ジョブのパラメータ上書き (#544)。守るべき不変条件:
 * - 上書きは **JOBS / JOBS_BY_ID / JOB_LEVEL_PACE / JOB_EQUIP_KINDS の参照を保ったまま**効く
 *   (各所が import 時に掴んでいるので、再代入すると片方だけ古い値のままになる)
 * - stats の合計 100 を崩す編集は通さない (職間の強さの物差しが消える)
 * - 壊れた 1 件で全体を落とす。null で完全にコード値へ戻る
 */
import { describe, it, expect, afterEach } from 'vitest';
import { JOBS, JOBS_BY_ID } from '../jobs.js';
import { JOB_LEVEL_PACE } from '../tuning.js';
import { JOB_EQUIP_KINDS, canEquip, EQUIPMENT_BY_ID } from '../equipment.js';
import { currentJobParams, setJobOverrides, JobDataError, JOB_STATS_SUM } from '../job-data.js';
import { jobLevelFromXp } from '../quest.js';

afterEach(() => setJobOverrides(null));

describe('setJobOverrides', () => {
  it('stats と vit が JOBS / JOBS_BY_ID の両方に効く (参照が保たれる)', () => {
    setJobOverrides([{ id: 'warrior', stats: [50, 20, 10, 10, 10], vit: 60 }]);
    const fromList = JOBS.find((j) => j.id === 'warrior')!;
    expect(fromList.stats).toEqual([50, 20, 10, 10, 10]);
    expect(fromList.vit).toBe(60);
    // JOBS_BY_ID は JOBS と同じオブジェクトを指しているはず
    expect(JOBS_BY_ID.warrior).toBe(fromList);
    expect(JOBS_BY_ID.warrior.stats).toEqual([50, 20, 10, 10, 10]);
  });

  it('pace が XP 曲線に効く (レベルが実際に動く)', () => {
    const xp = 500;
    const before = jobLevelFromXp(xp, 'warrior');
    setJobOverrides([{ id: 'warrior', pace: 0.2 }]); // うんと早く上がる
    expect(JOB_LEVEL_PACE.warrior).toBe(0.2);
    expect(jobLevelFromXp(xp, 'warrior')).toBeGreaterThan(before);
  });

  it('equipKinds が canEquip に効く', () => {
    const staff = EQUIPMENT_BY_ID['wp-novice-staff']!;
    expect(canEquip('warrior', staff)).toBe(false);
    setJobOverrides([{ id: 'warrior', equipKinds: ['staff'] }]);
    expect(canEquip('warrior', staff)).toBe(true);
  });

  it('未指定のフィールドはコード値のまま (部分上書き)', () => {
    const baseVit = JOBS_BY_ID.mage.vit;
    setJobOverrides([{ id: 'mage', pace: 0.9 }]);
    expect(JOBS_BY_ID.mage.vit).toBe(baseVit);
  });

  it('null で全部コード値に戻る', () => {
    const base = currentJobParams().find((j) => j.id === 'warrior')!;
    setJobOverrides([{ id: 'warrior', stats: [50, 20, 10, 10, 10], vit: 60, pace: 0.3, equipKinds: ['staff'] }]);
    setJobOverrides(null);
    const now = currentJobParams().find((j) => j.id === 'warrior')!;
    expect(now).toEqual(base);
  });

  it('一覧から外した職もコード値へ戻る (前回の上書きが残らない)', () => {
    const base = JOBS_BY_ID.mage.vit;
    setJobOverrides([{ id: 'mage', vit: 44 }]);
    setJobOverrides([{ id: 'warrior', vit: 44 }]); // mage は指定なし
    expect(JOBS_BY_ID.mage.vit).toBe(base);
  });
});

describe('検証', () => {
  it('stats の合計が 100 でないと落ちる', () => {
    expect(() => setJobOverrides([{ id: 'warrior', stats: [99, 99, 99, 99, 99] }])).toThrow(JobDataError);
    expect(() => setJobOverrides([{ id: 'warrior', stats: [10, 10, 10, 10, 10] }])).toThrow(JobDataError);
  });

  it('要素数 5 でない / 負 / 非数の stats を弾く', () => {
    expect(() => setJobOverrides([{ id: 'warrior', stats: [100, 0, 0, 0] as never }])).toThrow(JobDataError);
    expect(() => setJobOverrides([{ id: 'warrior', stats: [110, -10, 0, 0, 0] }])).toThrow(JobDataError);
    expect(() => setJobOverrides([{ id: 'warrior', stats: [NaN, 0, 0, 0, 0] as never }])).toThrow(JobDataError);
  });

  it('vit と pace の範囲外を弾く', () => {
    expect(() => setJobOverrides([{ id: 'warrior', vit: 0 }])).toThrow(JobDataError);
    expect(() => setJobOverrides([{ id: 'warrior', vit: 100 }])).toThrow(JobDataError);
    expect(() => setJobOverrides([{ id: 'warrior', pace: 0 }])).toThrow(JobDataError);
    expect(() => setJobOverrides([{ id: 'warrior', pace: 99 }])).toThrow(JobDataError);
  });

  it('未知のジョブ・重複・未知の装備カテゴリを弾く', () => {
    expect(() => setJobOverrides([{ id: 'nobody' as never }])).toThrow(JobDataError);
    expect(() => setJobOverrides([{ id: 'warrior' }, { id: 'warrior' }])).toThrow(JobDataError);
    expect(() => setJobOverrides([{ id: 'warrior', equipKinds: ['zzz' as never] }])).toThrow(JobDataError);
  });

  it('壊れた 1 件で全体を落とす (部分適用しない)', () => {
    const baseVit = JOBS_BY_ID.mage.vit;
    expect(() => setJobOverrides([
      { id: 'mage', vit: 44 },
      { id: 'warrior', stats: [1, 1, 1, 1, 1] }, // 合計 5 で落ちる
    ])).toThrow(JobDataError);
    expect(JOBS_BY_ID.mage.vit).toBe(baseVit); // 先頭の 1 件も効いていない
  });

  it('currentJobParams は今の値をそのまま返す (シミュ後の復元に使える)', () => {
    const snapshot = currentJobParams();
    setJobOverrides([{ id: 'warrior', vit: 55 }]);
    setJobOverrides(snapshot);
    expect(JOBS_BY_ID.warrior.vit).toBe(snapshot.find((j) => j.id === 'warrior')!.vit);
    expect(JOB_EQUIP_KINDS.warrior).toEqual(snapshot.find((j) => j.id === 'warrior')!.equipKinds);
  });

  it('合計 100 ちょうどは通る', () => {
    setJobOverrides([{ id: 'warrior', stats: [20, 20, 20, 20, 20] }]);
    expect(JOBS_BY_ID.warrior.stats.reduce((a, b) => a + b, 0)).toBe(JOB_STATS_SUM);
  });
});
