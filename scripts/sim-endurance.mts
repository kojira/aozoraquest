/**
 * 連戦の持久力を測る (#535 / #536)。
 *
 * **「街を出てから何戦できるか」がバランスの単位**。街は全回復地点で、HP・MP・やくそうは
 * 戦闘をまたいで持ち越し、瀕死なら野外でやくそうを飲む。単発の勝率だと「1 戦 90% でも
 * 回復が尽きて 3 戦で死ぬ」形を取り違える (オーナー指摘 2026-07-26)。
 *
 * `BATTLE_TUNING.monsterStatFloor` と `JOB_LEVEL_PACE` はこの計測から決める。
 * 敵の強さを触ったら必ず引き直すこと — スクリプトが repo に無いと引き直せないので置いてある。
 *
 * 使い方:
 *   pnpm --filter @aozoraquest/core sim:endurance
 *   TIER=2 LV=5 GEAR=ar-cloth pnpm --filter @aozoraquest/core sim:endurance
 *   TREE=/path/to/other/checkout pnpm --filter @aozoraquest/core sim:endurance   # dev と比較
 *
 * 環境変数:
 *   TIER   遭遇 tier (既定 1)
 *   LV     ジョブ Lv (既定 1)
 *   GEAR   装備 id をカンマ区切り (既定 なし。例 ar-cloth / ar-travel-cloak)
 *   TRIALS 職ごとの試行数 (既定 30)
 *   CAP    1 試行あたりの上限戦闘数 (既定 200。無限ループ防止)
 *   TREE   core を読むリポジトリのルート (既定 このリポジトリ)
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tree = process.env.TREE ?? resolve(here, '..');
const core = (await import(`${tree}/packages/core/src/index.js`)) as typeof import('../packages/core/src/index.js');

const { startBattle, runAutoBattle, JOBS, BATTLE_TUNING } = core;
const TIER = Number(process.env.TIER ?? 1);
const LV = Number(process.env.LV ?? 1);
const TRIALS = Number(process.env.TRIALS ?? 30);
const CAP = Number(process.env.CAP ?? 200);
const GEAR = process.env.GEAR ? process.env.GEAR.split(',') : undefined;
const herbMax = BATTLE_TUNING.herbCarryMax ?? 2;

const rows: Array<[string, number]> = [];
for (const job of JOBS) {
  let total = 0;
  for (let t = 0; t < TRIALS; t++) {
    let hp: number | undefined;
    let mp: number | undefined;
    let herbs = herbMax;
    let battles = 0;
    for (let b = 0; b < CAP; b++) {
      // seed は試行ごとに独立させる (同じ敵列を全職に当てると職ごとの相性で偏る)
      const s = startBattle(
        job.id,
        LV,
        1,
        'x',
        TIER as never,
        t * 977 + b,
        herbs,
        hp !== undefined ? { hp, mp: mp! } : undefined,
        GEAR ? { equipIds: GEAR } : undefined,
      );
      const r = runAutoBattle(s);
      if (r.outcome !== 'win') break;
      battles++;
      // 街に戻らない限り HP/MP/やくそうは持ち越し。ドロップで補充されることもある。
      hp = r.player.hp;
      mp = r.player.mp;
      herbs = Math.min(herbMax, r.herbs ?? 0);
    }
    total += battles;
  }
  rows.push([job.id, total / TRIALS]);
}

rows.sort((a, b) => a[1] - b[1]);
const avg = rows.reduce((sum, r) => sum + r[1], 0) / rows.length;
console.log(
  `tier${TIER} Lv${LV} ${GEAR ? GEAR.join('+') : '装備なし'} / ${TRIALS} 試行 — 平均 ${avg.toFixed(2)} 戦`,
);
console.log(rows.map(([id, v]) => `${id}:${v.toFixed(1)}`).join(' '));
