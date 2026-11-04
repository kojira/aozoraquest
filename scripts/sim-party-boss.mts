/**
 * ボスのパーティ sim (D-PARTY-001 §5)。ストーリー戦の敵 (BOSSES) を、主人公 16 職 × 仲間 0〜3 人で回す。
 * 敵の HP は ×(1 + BOSS_HP × 仲間の数) (edge の sealEncounter と同じ。既定は BATTLE_TUNING.bossHpPerAlly)。
 * 条件は boss-sim と同じ: にげない、やくそう 2・そらのしずく 1。
 *
 * 使い方:
 *   MONSTERS_JSON=/tmp/monsters.json pnpm --filter @aozoraquest/core sim:party-boss
 *   BOSSES='pave-golem:8:1' PARTY=solo,duo,trio,full BOSS_HP=0.5 ...
 *
 * BOSSES は「monsterId:想定 Lv:敵の数」をセミコロンで。既定は dev のボス 6 体 + itadaki-b-wisps (will-o-wisp ×3)。
 * 台本負けの x-rocket は入れない (1 対 1 のままで仲間は加わらず、負けて話が進む戦闘)。
 */
import { core, fight, PARTIES, median, minOf } from './sim-party-lib.mts';

const BOSSES = (process.env.BOSSES ?? 'heat-shroom-lord:3:1;echo-bat-lord:5:1;golden-lantern:6:1;pave-golem:8:1;bridge-crab-lord:10:1;kamen-yatagarasu:11:1;will-o-wisp:9:3')
  .split(';').map((s) => { const [id, lv, n] = s.split(':'); return { id: id!, lv: Number(lv), n: Number(n ?? 1) }; });
const N = Number(process.env.N ?? 100);
const BOSS_HP = process.env.BOSS_HP !== undefined ? Number(process.env.BOSS_HP) : core.BATTLE_TUNING.bossHpPerAlly;

for (const b of BOSSES) {
  const def = core.MONSTERS_BY_ID[b.id];
  if (!def) { console.log(`${b.id}: モンスターが無い (MONSTERS_JSON を確かめて)`); continue; }
  for (const pk of (process.env.PARTY ?? 'solo,duo,trio,full').split(',')) {
    const wins: number[] = [], turns: number[] = [];
    let worst = ['', 101] as [string, number];
    for (const job of core.ARCHETYPES) {
      let w = 0, t = 0;
      for (let sd = 0; sd < N; sd++) {
        const r = fight(job, b.lv, def.tier, sd * 2654435761 + b.lv * 7919, PARTIES[pk]!, { monsterId: b.id, story: true, extraEnemies: b.n - 1, bossHpPerAlly: BOSS_HP, tonics: 1 });
        if (r.outcome === 'win') { w++; t += r.turns; }
      }
      const rate = (w / N) * 100;
      wins.push(rate); turns.push(w ? t / w : 0);
      if (rate < worst[1]) worst = [job, rate];
    }
    console.log(`${b.id.padEnd(17)} ×${b.n} Lv${String(b.lv).padEnd(3)} ${pk.padEnd(5)} HP×${(1 + BOSS_HP * PARTIES[pk]!.length).toFixed(1)}: 勝率 min ${minOf(wins).toFixed(0)} med ${median(wins).toFixed(0)} (最低 ${worst[0]}) | ターン ${median(turns).toFixed(1)}`);
  }
}
