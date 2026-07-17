/**
 * バトルバランス・シミュレータ (docs/18 / docs/19 のチューニング用)。
 *
 * シナリオ: あおぞらワールドの「はじまりの街」近辺 (danger 0 = tier1) を想定し、
 * HP/MP が戦闘をまたいで持続するルールで **5 匹倒すまで生き残れるか** を全ジョブで測る。
 * 街に戻らない前提 (回復はドロップしたやくそう/そらのしずくのみ)。
 *
 * プレイヤー方針 (現実的な「上手い操作」の代表):
 *   ため予告 → ぼうぎょ / HP<45% かつ やくそう有 → やくそう /
 *   MP<特技コスト かつ しずく有 かつ MP減少大 → そらのしずく /
 *   MP が足りれば とくぎ / それ以外 たたかう
 *
 * 実行: pnpm exec tsx scripts/sim-battle-balance.ts [--trials 2000] [--jobLv 1] [--playerLv 1]
 *       [--base personal:atk,def,agi,int,luk] (個人 rpgStats 基底の感度分析用)
 */
import {
  ARCHETYPES,
  BATTLE_TUNING,
  JOBS_BY_ID,
  createRng,
  resolveTurn,
  rollDrops,
  startBattle,
  type Archetype,
  type BattleState,
  type StatArray,
} from '../packages/core/src/index.js';

const args = process.argv.slice(2);
function argNum(name: string, def: number): number {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
}
const TRIALS = argNum('trials', 2000);
const JOB_LV = argNum('jobLv', 1);
const PLAYER_LV = argNum('playerLv', 1);
const TIER = argNum('tier', 1) as 1 | 2 | 3;
const KILL_TARGET = argNum('kills', 5);
const MAX_BATTLES = 20; // draw 連発の無限ループ対策

let baseStats: StatArray | undefined;
const baseIdx = args.indexOf('--base');
if (baseIdx >= 0 && args[baseIdx + 1]) {
  const nums = args[baseIdx + 1]!.split(':').pop()!.split(',').map(Number);
  baseStats = [nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!];
}

function playPolicy(s: BattleState): BattleState {
  const t = BATTLE_TUNING;
  const isParry = s.playerSkill.kind === 'parry';
  for (let i = 0; i < 80 && s.outcome === 'ongoing'; i++) {
    const p = s.player;
    // parry (見切り) は「攻撃が来るターンに構える」のが正しい使い方。毎ターン
    // 空打ちすると火力ゼロで作戦負けする (人間はそう使わない) ので、
    // ため予告のターンだけ構え、それ以外は殴る。
    const cmd = s.monster.charging
      ? isParry && p.mp >= t.skillMpCost
        ? 'skill'
        : 'guard'
      : s.herbs > 0 && p.hp < p.maxHp * 0.45
        ? 'herb'
        : s.tonics > 0 && p.mp < t.skillMpCost && p.maxMp >= t.skillMpCost * 2
          ? 'tonic'
          : !isParry && p.mp >= t.skillMpCost
            ? 'skill'
            : 'attack';
    s = resolveTurn(s, cmd);
  }
  return s;
}

interface JobResult {
  job: Archetype;
  surviveRate: number; // 5 匹倒すまで生存
  avgKills: number;
  avgBattles: number;
  avgHpLeftPct: number; // 生存者の 5 匹目撃破時の残 HP%
  drawRuns: number; // draw で足踏みした試行の数
}

function simulateJob(job: Archetype, stats?: StatArray): JobResult {
  let survived = 0;
  let killsSum = 0;
  let battlesSum = 0;
  let hpLeftSum = 0;
  let drawRuns = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    const rng = createRng((trial * 2654435761 + ARCHETYPES.indexOf(job) * 97 + 1) >>> 0);
    let hp: number | undefined;
    let mp: number | undefined;
    let invHerb = 0;
    let invTonic = 0;
    let kills = 0;
    let battles = 0;
    let sawDraw = false;
    let dead = false;
    while (kills < KILL_TARGET && battles < MAX_BATTLES) {
      battles++;
      const seed = Math.floor(rng() * 0xffffffff) >>> 0;
      const carryHerbs = Math.min(BATTLE_TUNING.herbCarryMax, invHerb);
      const carryTonics = Math.min(BATTLE_TUNING.tonicCarryMax, invTonic);
      const carry: { hp?: number; mp?: number } = {};
      if (hp !== undefined) carry.hp = hp;
      if (mp !== undefined) carry.mp = mp;
      const extras: { tonics?: number; baseStats?: StatArray } = { tonics: carryTonics };
      if (stats) extras.baseStats = stats;
      const end = playPolicy(startBattle(job, JOB_LV, PLAYER_LV, 'sim', TIER, seed, carryHerbs, carry, extras));
      invHerb -= end.herbsUsed;
      invTonic -= end.tonicsUsed;
      if (end.outcome === 'lose') {
        dead = true;
        break;
      }
      if (end.outcome === 'win') {
        kills++;
        for (const d of rollDrops(end.monsterId, end.player.luk, end.seed)) {
          if (d === 'herb') invHerb++;
          if (d === 'sky-dew') invTonic++;
        }
      } else {
        sawDraw = true; // draw: 倒せなかったが生きている (HP/MP は持続)
      }
      hp = end.player.hp;
      mp = end.player.mp;
      if (kills === KILL_TARGET) hpLeftSum += end.player.hp / end.player.maxHp;
    }
    if (!dead && kills >= KILL_TARGET) survived++;
    killsSum += kills;
    battlesSum += battles;
    if (sawDraw) drawRuns++;
  }
  return {
    job,
    surviveRate: survived / TRIALS,
    avgKills: killsSum / TRIALS,
    avgBattles: battlesSum / TRIALS,
    avgHpLeftPct: survived > 0 ? hpLeftSum / survived : 0,
    drawRuns,
  };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
console.log(
  `# tier${TIER} を ${KILL_TARGET} 匹倒すまで生存 (jobLv${JOB_LV}/playerLv${PLAYER_LV}, ${TRIALS} 試行` +
    (baseStats ? `, 個人基底 [${baseStats.join(',')}]` : ', ジョブ基準値') +
    ')',
);
console.log('job              | 生存率  | 平均討伐 | 平均戦闘数 | 生存時残HP | draw発生試行');
const results = ARCHETYPES.map((a) => simulateJob(a, baseStats));
results.sort((a, b) => b.surviveRate - a.surviveRate);
for (const r of results) {
  const jobStats = JOBS_BY_ID[r.job].stats;
  console.log(
    `${r.job.padEnd(16)} | ${pct(r.surviveRate).padStart(6)} | ${r.avgKills.toFixed(2).padStart(7)} | ${r.avgBattles
      .toFixed(2)
      .padStart(9)} | ${pct(r.avgHpLeftPct).padStart(9)} | ${String(r.drawRuns).padStart(5)}  [${jobStats.join(',')}]`,
  );
}
