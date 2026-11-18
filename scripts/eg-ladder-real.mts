/** D-ENDGAME-001 §A1/§A2 の梯子 sim を本物の品で。帯 t の想定 Lv で、grade g の 1 式を着た主人公 16 職が帯 t の敵 (群れあり) と戦う。
 *  MONSTERS_JSON / ITEMS_JSON (= admin-data get の出力)。N=200 ENDU=20。 */
import { core, fight, median, minOf } from './sim-party-lib.mts';
import { bestGearFor } from './eg-gear.mts';
const N = Number(process.env.N ?? 200), ENDU = Number(process.env.ENDU ?? 20);
const LV = [0, 1, 4, 8, 13, 19, 26];
const tiers: number[] = JSON.parse(process.env.TIERS ?? '[1,2,3,4,5,6]');
const cases: Array<[string, number, number]> = [['i', -1, 0], ['ii', 0, 0], ['iii', 0, 1]];
for (const t of tiers) {
  const lv = LV[t]!;
  const pool = core.MONSTERS.filter((m) => m.tier === t && !m.storyOnly);
  console.log(`t${t} Lv${lv} 敵 ${pool.map((m) => { const c = core.monsterCombatant(m, 0, () => 0.5); return `${c.atk}/${c.def}/${c.maxHp}`; }).join(' ')}`);
  for (const [name, dg, mates] of cases) {
    const g = t + dg; const wins: number[] = [], turns: number[] = [], endu: number[] = [];
    for (const job of core.ARCHETYPES) {
      const gear = bestGearFor(core, job, g); const ms = (mates ? ['warrior'] : []) as never[]; const mateGear = bestGearFor(core, 'warrior', g);
      let w = 0, tt = 0;
      for (let sd = 0; sd < N; sd++) { const r = fight(job, lv, t, sd * 7919 + 13 + t, ms, { gear, mateGear, group: t >= 2, tonics: 1 }); if (r.outcome === 'win') { w++; tt += r.turns; } }
      wins.push((w / N) * 100); turns.push(w ? tt / w : 0);
      let ok = 0; for (let k = 0; k < ENDU; k++) { let carry; let b = 0; for (; b < 5; b++) { const r = fight(job, lv, t, k * 977 + b * 31 + 5, ms, { gear, mateGear, group: t >= 2, tonics: 1, ...(carry ? { carry } : {}) }); if (r.outcome !== 'win') break; carry = r.carry; } if (b >= 5) ok++; }
      endu.push(ok / ENDU * 100);
    }
    if (process.env.PERJOB) console.log('   ', core.ARCHETYPES.map((j, i) => `${j}:${wins[i]!.toFixed(0)}`).join(' '));
    console.log(`  (${name}) g${g}${mates ? '+仲間1' : ''}: 勝率 min ${minOf(wins).toFixed(0)} med ${median(wins).toFixed(0)} | ターン ${median(turns).toFixed(1)} | 5連戦 ${median(endu).toFixed(0)}%`);
  }
}
