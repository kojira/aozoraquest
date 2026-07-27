import { describe, it, expect } from 'vitest';
import { startBattle, resolveTurn, JOB_MP_TRAITS, mpGainsFor, JOBS } from '../index.js';

/**
 * **パラディンの MP 回復は確率発動** (#564)。回復とくぎ (聖光の癒し) と
 * 確実な MP 回復が噛み合うと資源が尽きず、低 tier を無限に周回できてしまう。
 *
 * `chance` を持たないジョブは**乱数を 1 つも引かない**こと。引くと乱数ストリームが
 * ずれて他ジョブの戦闘結果まで変わる (world-data の決定論テストが落ちる)。
 */
describe('MP 特性の確率発動 (#564)', () => {
  it('パラディンだけが chance を持つ (他ジョブは従来どおり毎ターン確実)', () => {
    const withChance = Object.entries(JOB_MP_TRAITS)
      .filter(([, t]) => t?.chance !== undefined)
      .map(([id]) => id);
    expect(withChance).toEqual(['paladin']);
    expect(mpGainsFor('paladin').chance).toBe(0.5);
    expect(mpGainsFor('paladin').attackGain).toBe(1);
    expect(mpGainsFor('paladin').guardGain).toBe(1);
    // 特性を持つ他ジョブは chance なし = 乱数を引かない
    for (const job of JOBS) {
      if (job.id === 'paladin') continue;
      expect(mpGainsFor(job.id).chance, `${job.id}`).toBeUndefined();
    }
  });

  it('ぼうぎょの MP 回復が毎回は起きない (だいたい設定した確率で起きる)', () => {
    let fired = 0;
    const N = 400;
    for (let seed = 0; seed < N; seed++) {
      // MP を減らしてから測る (満タンだと増えたか分からない)
      const s = startBattle('paladin', 10, 1, 'x', 1, seed, 0, { hp: 40, mp: 1 });
      const after = resolveTurn(s, 'guard', seed * 31 + 7);
      if (after.player.mp > s.player.mp) fired++;
    }
    const rate = fired / N;
    // 従来は 1.0 (毎回)。0 でも 1 でもないこと + 設定値の周辺であることを見る。
    expect(rate, `発動率 ${rate}`).toBeGreaterThan(0.35);
    expect(rate, `発動率 ${rate}`).toBeLessThan(0.65);
  });

  it('chance の無いジョブは毎ターン必ず回復する (退行検知)', () => {
    // bard の 歌の余韻 は従来どおり確実。ここが確率になったら気づけるようにする。
    for (let seed = 0; seed < 60; seed++) {
      const s = startBattle('bard', 10, 1, 'x', 1, seed, 0, { hp: 40, mp: 1 });
      const after = resolveTurn(s, 'guard', seed * 31 + 7);
      expect(after.player.mp, `bard seed=${seed}`).toBeGreaterThan(s.player.mp);
    }
  });
});
