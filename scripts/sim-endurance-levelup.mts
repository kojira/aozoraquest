/**
 * **レベルアップと XP 蓄積を含めた**連戦の持久力 (#547)。
 *
 * `sim-endurance.mts` は 1 戦ごとに Lv 固定なので、レベルアップ全回復の効果を測れない。
 * こちらは XP を貯めてレベルを上げ、上がったら HP/MP を全快させる = 実際の遊びに近い。
 *
 * 使い方:
 *   pnpm --filter @aozoraquest/core sim:endurance-lv
 *   HEAL=0 TIER=2 CAP=200 pnpm --filter @aozoraquest/core sim:endurance-lv
 *
 * 環境変数: TIER (既定 1) / CAP (1 試行の上限戦闘数、既定 100) / HEAL (0 で全回復なし)
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const c = (await import(`${resolve(here, '..')}/packages/core/src/index.js`)) as typeof import('../packages/core/src/index.js');
const { startBattle, runAutoBattle, JOBS, BATTLE_TUNING, jobLevelFromXp, battleXpFor } = c;
const TIER = Number(process.env.TIER ?? 1), TRIALS = 30, CAP = Number(process.env.CAP ?? 100);
const HEAL = process.env.HEAL !== '0';
const herbMax = BATTLE_TUNING.herbCarryMax ?? 2;
const rows: Array<[string, number]> = [];
for (const j of JOBS) {
  let total = 0;
  for (let t = 0; t < TRIALS; t++) {
    let hp: number | undefined, mp: number | undefined, herbs = herbMax, xp = 0, battles = 0;
    for (let b = 0; b < CAP; b++) {
      const lv = jobLevelFromXp(xp, j.id);
      const s = startBattle(j.id, lv, 1, 'x', TIER, t * 977 + b, herbs, hp !== undefined ? { hp, mp: mp! } : undefined);
      const r = runAutoBattle(s);
      if (r.outcome !== 'win') break;
      battles++;
      const before = lv;
      xp += battleXpFor(r.monsterId);
      const after = jobLevelFromXp(xp, j.id);
      if (HEAL && after > before) { hp = undefined; mp = undefined; }
      else { hp = r.player.hp; mp = r.player.mp; }
      herbs = Math.min(herbMax, r.herbs ?? 0);
    }
    total += battles;
  }
  rows.push([j.id, total / TRIALS]);
}
rows.sort((a, b) => a[1] - b[1]);
const avg = rows.reduce((s, r) => s + r[1], 0) / rows.length;
console.log(`tier${TIER} ${HEAL ? '全回復あり' : '全回復なし'} 上限${CAP}戦 — 平均 ${avg.toFixed(2)} 戦`);
console.log(rows.map(([id, v]) => `${id}:${v.toFixed(1)}`).join(' '));
