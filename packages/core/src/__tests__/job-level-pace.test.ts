import { describe, it, expect } from 'vitest';
import { jobXpCurveFor, jobLevelFromXpFor, jobXpToNextLevelFor, JOB_XP_CURVE, JOB_LEVEL_PACE, JOBS, MONSTERS, battleXpFor } from '../index.js';

/**
 * 職ごとのレベル曲線 (#536)。**DQ3 を参照して設計した** — DQ3 も職業ごとに必要経験値が違い、
 * Lv99 で勇者 630 万に対し賢者 960 万 (1.5 倍) の開きがある。
 *
 * 方針: **勝率・持久力の高い職ほどレベルが上がりにくい** (オーナー 2026-07-26)。
 * 弱い職を数字で底上げしなくても最終的な到達点が揃う。
 */
describe('職ごとのレベル曲線 (#536)', () => {
  const th = (job: string, lv: number) => jobXpCurveFor(job).find((e) => e[0] === lv)?.[1] ?? 0;

  it('全16職に pace が定義されている (定義漏れは静かに基準値になるので明示的に守る)', () => {
    for (const j of JOBS) expect(JOB_LEVEL_PACE[j.id], `${j.id} の pace`).toBeGreaterThan(0);
  });

  it('持久力の高い職ほどレベルが上がりにくい', () => {
    // 連戦数の実測順 (scripts/sim-endurance.mts。tier1 Lv1 装備なし) が
    // 必要 XP の順序に反映されていること。**全 16 職の全順序**を見る — 5 職だけ
    // 抜き出すと、間の職を入れ替えても緑のまま通ってしまう。
    const ORDER = Object.entries(JOB_LEVEL_PACE).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(ORDER.length).toBe(JOBS.length); // 職を足したら pace も足す
    for (const lv of [5, 10, 30]) {
      for (let i = 1; i < ORDER.length; i++) {
        const [prev, cur] = [ORDER[i - 1]!, ORDER[i]!];
        if (JOB_LEVEL_PACE[prev] === JOB_LEVEL_PACE[cur]) continue; // 同値は順不同
        expect(th(prev, lv), `${prev} < ${cur} (Lv${lv})`).toBeLessThan(th(cur, lv));
      }
    }
  });

  it('職差は序盤に大きく、後半に収束する (DQ3 準拠)', () => {
    // DQ3: Lv10 で最大 2.5 倍 → Lv50 で 1.46 倍。定数倍だと後半も開いたままで、
    // 強い職がいつまでも追いつけない。
    const spread = (lv: number) => th('shogun', lv) / th('mage', lv);
    expect(spread(5)).toBeGreaterThan(spread(30));
    expect(spread(30)).toBeGreaterThan(spread(50));
    expect(spread(50)).toBeLessThan(1.3); // 終盤はほぼ揃う
    expect(spread(2)).toBeGreaterThan(1.4); // 序盤は明確に差がある
  });

  it('未知の職は基準曲線をそのまま使う (将来の職追加で落ちない)', () => {
    expect(jobXpCurveFor('unknown-job')).toEqual(JOB_XP_CURVE);
  });

  it('jobLevelFromXpFor / jobXpToNextLevelFor が曲線と整合する', () => {
    for (const j of JOBS) {
      for (const lv of [2, 10, 30]) {
        const need = th(j.id, lv);
        expect(jobLevelFromXpFor(j.id, need), `${j.id} Lv${lv} ちょうど`).toBe(lv);
        expect(jobLevelFromXpFor(j.id, need - 1), `${j.id} Lv${lv} 手前`).toBe(lv - 1);
        const p = jobXpToNextLevelFor(j.id, need);
        expect(p.level).toBe(lv);
        expect(p.current).toBe(0); // しきい値ちょうどなら進捗 0
      }
      expect(jobXpToNextLevelFor(j.id, th(j.id, 50)).next).toBe(0); // 打ち止め
    }
  });

  it('1 レベル上げるのに必要な戦闘数が現実的な範囲に収まる', () => {
    // DQ3 は中盤以降 1 レベルに数十戦かかる。極端に速い/遅いと成長の手触りが壊れるので、
    // その帯の敵で 3〜60 戦に収まることを固定する。
    const avgXp = (tier: number) => {
      const m = MONSTERS.filter((x) => x.tier === tier && x.species !== 'metal-slime');
      return m.reduce((s, x) => s + battleXpFor(x.id), 0) / m.length;
    };
    for (const j of JOBS) {
      // 想定レベル → tier は TIER_LEVEL {1:1, 2:4, 3:8, 4:13, 5:19, 6:26} に対応 (#536)。
      for (const [lv, tier] of [[2, 1], [5, 2], [10, 3], [20, 5], [30, 6], [50, 6]] as const) {
        const need = th(j.id, lv) - th(j.id, lv - 1);
        const battles = need / avgXp(tier);
        expect(battles, `${j.id} Lv${lv - 1}→${lv} (tier${tier})`).toBeGreaterThan(3);
        expect(battles, `${j.id} Lv${lv - 1}→${lv} (tier${tier})`).toBeLessThan(60);
      }
    }
  });
});
