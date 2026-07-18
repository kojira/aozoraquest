/**
 * 全 16 ジョブの勝率分布 (アイテム調整の基礎数値。docs/20 リリース必須要件 #6)。
 * 目標帯: 装備なし tier3 = 挑戦的 (概ね 45-65%) / フル装備 = 快適だが自明でない (80-92%)。
 * 実行: pnpm exec tsx scripts/sim-all-jobs.ts
 */
import { ARCHETYPES, BATTLE_TUNING, resolveTurn, startBattle, type Archetype, type BattleState, type Command } from '../packages/core/src/index.js';

const play = (job: Archetype, jobLv: number, plLv: number, tier: 1 | 2 | 3, seed: number, equip: string[]): string => {
  let s = startBattle(job, jobLv, plLv, 'x', tier, seed, BATTLE_TUNING.herbCarryMax, undefined, { tonics: BATTLE_TUNING.tonicCarryMax, equipIds: equip });
  const isParry = s.playerSkill.kind === 'parry';
  for (let i = 0; i < 80 && s.outcome === 'ongoing'; i++) {
    const p = s.player;
    const cmd: Command = s.monster.charging ? (isParry && p.mp >= 4 ? 'skill' : 'guard')
      : s.herbs > 0 && p.hp < p.maxHp * 0.45 ? 'herb'
      : s.tonics > 0 && p.mp < 4 && p.maxMp - p.mp >= 6 ? 'tonic'
      : !isParry && p.mp >= 4 ? 'skill' : 'attack';
    s = resolveTurn(s, cmd);
  }
  return s.outcome;
};

const rate = (job: Archetype, jobLv: number, plLv: number, tier: 1 | 2 | 3, equip: string[]): number => {
  let w = 0;
  const N = 400;
  for (let seed = 0; seed < N; seed++) if (play(job, jobLv, plLv, tier, seed, equip) === 'win') w++;
  return Math.round((w / N) * 1000) / 10;
};

// フル装備 = 専用武器(上位) + 鉄のよろい(def8) + いのちのペンダント(maxHp10)
const fullGear = (job: Archetype) => [`wp-${job}-high`, 'ar-iron', 'ch-life'];

const rows: { job: string; t1: number; t3bare: number; t3full: number }[] = [];
for (const job of ARCHETYPES) {
  rows.push({
    job,
    t1: rate(job, 1, 1, 1, []),
    t3bare: rate(job, 8, 15, 3, []),
    t3full: rate(job, 8, 15, 3, fullGear(job)),
  });
}
rows.sort((a, b) => a.t3bare - b.t3bare);
const pad = (x: string | number, n: number) => String(x).padStart(n);
console.log('job          t1裸  t3裸  t3フル');
for (const r of rows) console.log(`${r.job.padEnd(11)} ${pad(r.t1, 5)} ${pad(r.t3bare, 5)} ${pad(r.t3full, 6)}`);
const stat = (key: 't1' | 't3bare' | 't3full') => {
  const v = rows.map((r) => r[key]).sort((a, b) => a - b);
  return `min ${v[0]} / med ${v[Math.floor(v.length / 2)]} / max ${v[v.length - 1]}`;
};
console.log('---');
console.log('t1裸  :', stat('t1'));
console.log('t3裸  :', stat('t3bare'));
console.log('t3フル:', stat('t3full'));
