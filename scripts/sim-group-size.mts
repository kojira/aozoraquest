/**
 * 群れの数と人数の sim (D-PARTY-005)。帯 t の想定 Lv で、その帯の装備 (主人公も仲間も。scripts/eg-gear.mts) の
 * 主人公 16 職 + 仲間 0〜3 人が、帯 t のふつうの敵と core の群れ (BATTLE_TUNING.groupChance) で戦う。
 * 人数 × tier ごとに、敵の数の分布・勝率 (min / 中央値)・ターン (勝った戦の平均)・敵の数ごとの勝率 (1〜5 体) を出す。
 *
 * 使い方:
 *   MONSTERS_JSON=/tmp/monsters.json ITEMS_JSON=/tmp/items.json pnpm --filter @aozoraquest/core exec tsx ../../scripts/sim-group-size.mts
 * 環境変数:
 *   GROUP  BATTLE_TUNING.groupChance の上書き (同じ形の JSON。試すとき)。無ければ core の値
 *   PARTY  sim-party-lib の PARTIES のキー (既定 solo,duo,trio,full)
 *   TIERS  既定 [1,2,3,4,5,6]
 *   N      職ごとの戦闘数 (既定 200)
 */
import { core, fight, PARTIES, median, minOf } from './sim-party-lib.mts';
import { bestGearFor } from './eg-gear.mts';

if (process.env.GROUP) Object.assign(core.BATTLE_TUNING.groupChance, JSON.parse(process.env.GROUP));
const N = Number(process.env.N ?? 200);
const LV = [0, 1, 4, 8, 13, 19, 26];
const tiers: number[] = JSON.parse(process.env.TIERS ?? '[1,2,3,4,5,6]');
const pct = (x: number) => (x * 100).toFixed(0).padStart(3);

for (const pk of (process.env.PARTY ?? 'solo,duo,trio,full').split(',')) for (const t of tiers) {
  const mates = PARTIES[pk]!; const lv = LV[t]!;
  const sizes = [0, 0, 0, 0, 0, 0]; const wins: number[] = []; let turns = 0, won = 0; const winsBySize = [0, 0, 0, 0, 0, 0];
  for (const job of core.ARCHETYPES) {
    const gear = bestGearFor(core, job, t);
    let w = 0;
    for (let sd = 0; sd < N; sd++) {
      const seed = sd * 7919 + 13 + t;
      // 敵の数は startBattle と同じ (主敵の抽選 → encounterGroupSize)。
      const n = core.startBattle(job, lv, 1, 'hero', t as never, seed >>> 0, 0, undefined, { group: { partySize: 1 + mates.length } }).enemies?.length ?? 1;
      sizes[n]!++;
      const r = fight(job, lv, t, seed, mates, { gear, mateGear: bestGearFor(core, 'warrior', t), group: true, tonics: 1 });
      if (r.outcome === 'win') { w++; won++; turns += r.turns; }
      if (r.outcome === 'win') winsBySize[n]!++;
    }
    wins.push((w / N) * 100);
  }
  const all = core.ARCHETYPES.length * N;
  console.log(`${pk.padEnd(5)} t${t} Lv${String(lv).padEnd(2)} 敵 1-5: ${sizes.slice(1).map((x) => pct(x / all)).join(' ')}% | 勝率 med ${median(wins).toFixed(0)} min ${minOf(wins).toFixed(0)} | ターン ${(turns / Math.max(1, won)).toFixed(1)}`
    + ` | 数ごとの勝率 ${sizes.slice(1).map((x, i) => (x ? pct(winsBySize[i + 1]! / x) : '  -')).join(' ')}`);
}
