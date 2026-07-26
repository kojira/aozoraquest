/**
 * **全職 × tier × 装備段階**の連戦マトリクス (#562)。
 *
 * `sim-endurance*.mts` は素手しか測っていなかったため、grade2 の防具 1 点で tier1 が
 * 無限連戦になっていたことに気づけなかった。装備は数分で手に入るので、**素手の数字は
 * バランスの代表値ではない**。ここで「素手 / grade1 / grade2」の 3 段を並べて、
 * どの段でも tier が上がるほど厳しくなる (= 進む動機になる) ことを確認する。
 *
 *   pnpm --filter @aozoraquest/core sim:gear-matrix
 *   LV=10 pnpm --filter @aozoraquest/core sim:gear-matrix
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const c = (await import(`${resolve(here, '..')}/packages/core/src/index.js`)) as typeof import('../packages/core/src/index.js');
const { startBattle, runAutoBattle, JOBS } = c;

const LV = Number(process.env.LV ?? 5);
const TRIALS = 20;
/** 打ち切り。ここに張り付いたら「実質無限 = バランスが壊れている」の合図。 */
const CAP = 300;

/** 段階。武器は職ごとに変わるので防具だけで測る (実測で武器はほぼ効かなかった)。 */
const STEPS: Array<{ name: string; gear?: Record<string, { id: string; level: number }> }> = [
  { name: '素手  ' },
  { name: 'grade1' , gear: { armor: { id: 'ar-leather', level: 0 } } },
  { name: 'grade2', gear: { armor: { id: 'ar-iron', level: 0 } } },
];

const chain = (job: Parameters<typeof startBattle>[0], tier: Parameters<typeof startBattle>[4], extras?: object) => {
  let total = 0;
  for (let t = 0; t < TRIALS; t++) {
    let hp: number | undefined, mp: number | undefined, n = 0;
    for (let b = 0; b < CAP; b++) {
      const s = startBattle(job, LV, 1, 'x', tier, t * 977 + b, 0, hp !== undefined ? { hp, mp: mp! } : undefined, extras as never);
      const r = runAutoBattle(s);
      if (r.outcome !== 'win') break;
      n++; hp = r.player.hp; mp = r.player.mp;
    }
    total += n;
  }
  return total / TRIALS;
};

console.log(`Lv${LV} 回復なしの連戦 (${TRIALS} 試行平均、${CAP} 戦で打ち切り)\n`);
for (const step of STEPS) {
  const extras = step.gear ? { gear: step.gear } : undefined;
  const line: string[] = [];
  for (const tier of [1, 2, 3] as const) {
    const vals = JOBS.map((j) => chain(j.id, tier, extras));
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const max = Math.max(...vals);
    line.push(`tier${tier} 平均${avg.toFixed(1)}戦 (最長 ${max.toFixed(0)}${max >= CAP ? ' ← 打ち切り!' : ''})`);
  }
  console.log(`${step.name}  ${line.join('  ')}`);
}
