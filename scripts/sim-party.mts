/**
 * パーティと群れの sim (D-PARTY-001)。主人公 16 職 × 仲間 (PARTY) × 敵の数 (NS) か、群れの抽選 (GROUP) で、
 * 勝率 (min / 中央値)・XP/戦・ターン・連戦 (街を出てから負けるまで、上限 40。仲間の HP/MP も持ちこす) を出す。
 *
 * 使い方:
 *   pnpm --filter @aozoraquest/core sim:party
 *   MONSTERS_JSON=/tmp/monsters.json PARTY=solo,duo,full GROUP='{"1":[0.08,0],"2":[0.15,0.03],"3":[0.25,0.10]}' pnpm --filter @aozoraquest/core sim:party
 *
 * 環境変数:
 *   PARTY  sim-party-lib の PARTIES のキー (既定 solo,duo,full)
 *   CASES  [[Lv, tier], ...] (既定 [[1,1],[3,1],[5,2],[8,2],[8,3],[11,3]])
 *   NS     敵の数の列 (既定 [1,2,3])。GROUP があれば無視
 *   GROUP  tier ごとの [2 体の確率, 3 体の確率]。遭遇の seed で決める (P4 の encounterGroupSize と同じ考え方)
 *   N      職ごとの単発の戦闘数 (既定 100)、ENDU 連戦の試行数 (既定 10。0 で連戦を出さない)
 */
import { core, fight, PARTIES, median, minOf } from './sim-party-lib.mts';

const CASES: Array<[number, number]> = JSON.parse(process.env.CASES ?? '[[1,1],[3,1],[5,2],[8,2],[8,3],[11,3]]');
const GROUP: Record<string, [number, number]> | null = process.env.GROUP ? JSON.parse(process.env.GROUP) : null;
const NS: number[] = GROUP ? [0] : JSON.parse(process.env.NS ?? '[1,2,3]');
const N = Number(process.env.N ?? 100);
const ENDU = Number(process.env.ENDU ?? 10);
/** 群れの数: tier の [p2, p3] を seed から引く。 */
const pick = (tier: number, seed: number) => {
  const [p2, p3] = GROUP?.[String(Math.min(3, tier))] ?? [0, 0];
  const r = ((seed * 2654435761) >>> 0) / 2 ** 32;
  return r < p3 ? 3 : r < p3 + p2 ? 2 : 1;
};

for (const pk of (process.env.PARTY ?? 'solo,duo,full').split(',')) for (const [lv, tier] of CASES) for (const n of NS) {
  const mates = PARTIES[pk]!;
  const wins: number[] = [], xps: number[] = [], turns: number[] = [], endu: number[] = [];
  let worst = ['', 101] as [string, number];
  for (const job of core.ARCHETYPES) {
    let w = 0, xp = 0, t = 0;
    for (let sd = 0; sd < N; sd++) {
      const seed = sd * 7919 + 13;
      const r = fight(job, lv, tier, seed, mates, { extraEnemies: (n || pick(tier, seed)) - 1 });
      if (r.outcome === 'win') w++;
      xp += r.xp; t += r.turns;
    }
    const rate = (w / N) * 100;
    wins.push(rate); xps.push(xp / N); turns.push(t / N);
    if (rate < worst[1]) worst = [job, rate];
    if (ENDU > 0) {
      let e = 0;
      for (let k = 0; k < ENDU; k++) {
        let carry; let b = 0;
        for (; b < 40; b++) {
          const seed = k * 977 + b * 31 + 5;
          const r = fight(job, lv, tier, seed, mates, { extraEnemies: (n || pick(tier, seed)) - 1, ...(carry ? { carry } : {}) });
          if (r.outcome !== 'win' && r.outcome !== 'fled' && r.outcome !== 'monster-fled') break;
          carry = r.carry;
        }
        e += b;
      }
      endu.push(e / ENDU);
    }
  }
  console.log(`${pk.padEnd(5)} Lv${lv} t${tier} 敵${n || 'mix'}: 勝率 min ${minOf(wins).toFixed(0)} med ${median(wins).toFixed(0)} (最低 ${worst[0]}) | XP/戦 ${median(xps).toFixed(1)} | ターン ${median(turns).toFixed(1)}`
    + (ENDU > 0 ? ` | 連戦 min ${minOf(endu).toFixed(1)} med ${median(endu).toFixed(1)}` : ''));
}
