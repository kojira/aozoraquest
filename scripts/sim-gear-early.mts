/**
 * **序盤に手に入る装備を着けたときの tier1 の手応え** (オーナー報告 2026-07-27
 * 「レベル5でこの装備だと tier1 だと敵なしで賢者なのに余裕で殴り殺しできます」)。
 *
 * `sim-endurance*.mts` は**素手・素の防具なし**で測っていたので、grade2 の防具を
 * 買った直後 (= 実際にはすぐそうなる) の状態が測れていなかった。ここでは
 * 「被ダメが 0 になっている割合」と「何戦連続で行けるか」を装備あり/なしで並べる。
 *
 * **連戦は XP を貯めてレベルアップ全回復も再現する** (既定)。装備だけ入れて全回復を
 * 入れないと、本番と違う条件の数字が出る — 実際に #562 の最初の修正でこれをやって、
 * 「47 戦」と書いたものが実際には打ち切りまで無敗だった (レビュー指摘 2026-07-27)。
 * `HEAL=0` で全回復なし (レベル固定) にできる。
 *
 *   pnpm --filter @aozoraquest/core sim:gear-early
 *   JOB=sage LV=5 TIER=1 HEAL=0 pnpm --filter @aozoraquest/core sim:gear-early
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const c = (await import(`${resolve(here, '..')}/packages/core/src/index.js`)) as typeof import('../packages/core/src/index.js');
const { startBattle, runAutoBattle, BATTLE_TUNING, MONSTERS, monsterCombatant, jobLevelFromXp, jobXpCurveFor, battleXpFor } = c;

const JOB = (process.env.JOB ?? 'sage') as Parameters<typeof startBattle>[0];
const LV = Number(process.env.LV ?? 5);
const TIERS = (process.env.TIER ? [Number(process.env.TIER)] : [1, 2, 3]) as Array<Parameters<typeof startBattle>[4]>;
const TRIALS = 200;
/** レベルアップ全回復を再現するか (既定 on = 本番と同じ条件)。 */
const HEAL = process.env.HEAL !== '0';
/** 連戦の打ち切り。ここに張り付いたら「実質無限 = バランスが壊れている」の合図。 */
const CAP = 500;
const xpAtLevel = (lv: number, job: string) => jobXpCurveFor(job).find((e) => e[0] === lv)?.[1] ?? 0;

const LOADOUTS: Array<{ name: string; gear?: Record<string, { id: string; level: number }> }> = [
  { name: '素手' },
  { name: '防具のみ (まなびのローブ+1)', gear: { armor: { id: 'ar-scholar', level: 1 } } },
  {
    name: '報告の装備 (賢者の杖+1 / まなびのローブ+1)',
    gear: { weapon: { id: 'wp-sage-mid', level: 1 }, armor: { id: 'ar-scholar', level: 1 } },
  },
];

console.log(`job=${JOB} Lv${LV}  atkCoef=${BATTLE_TUNING.atkCoef} defCoef=${BATTLE_TUNING.defCoef} floor=${BATTLE_TUNING.monsterStatFloor}`);

for (const TIER of TIERS) {
// tier の敵の素の攻撃力を見ておく (0 ダメージの構造的な原因確認)
const pool = MONSTERS.filter((m) => m.tier === TIER);
console.log(`\n── tier${TIER} (${pool.length} 種: ${pool.map((m) => `${m.name}(素atk${m.stats[0]})`).join(' ')})`);

for (const lo of LOADOUTS) {
  let hpLoss = 0, turns = 0, zeroTurns = 0, wins = 0, chain = 0;
  const extras = lo.gear ? { gear: lo.gear as never } : undefined;
  for (let t = 0; t < TRIALS; t++) {
    const s = startBattle(JOB, LV, 1, 'x', TIER, t * 7919, 0, undefined, extras);
    const r = runAutoBattle(s);
    if (r.outcome === 'win') wins++;
    const lost = s.player.maxHp - r.player.hp;
    hpLoss += lost;
    turns += r.turns ?? 0;
    if (lost === 0) zeroTurns++;
  }
  // 連戦 (HP/MP 持ち越し・薬草なし・宿屋なし)。HEAL のとき **XP を貯めてレベルアップで
  // 全回復**する = 本番と同じ条件。ここを省くと装備の効きを大きく過小評価する (#562)。
  let totalChain = 0, capped = 0;
  for (let t = 0; t < 30; t++) {
    let hp: number | undefined, mp: number | undefined, n = 0, xp = xpAtLevel(LV, JOB);
    for (let b = 0; b < CAP; b++) {
      const lv = HEAL ? jobLevelFromXp(xp, JOB) : LV;
      const s = startBattle(JOB, lv, 1, 'x', TIER, t * 977 + b, 0, hp !== undefined ? { hp, mp: mp! } : undefined, extras);
      const r = runAutoBattle(s);
      if (r.outcome !== 'win') break;
      n++;
      xp += battleXpFor(r.monsterId);
      if (HEAL && jobLevelFromXp(xp, JOB) > lv) { hp = undefined; mp = undefined; }
      else { hp = r.player.hp; mp = r.player.mp; }
    }
    totalChain += n;
    if (n >= CAP) capped++;
  }
  chain = totalChain / 30;
  console.log(
    `${lo.name.padEnd(38)} 勝率 ${((wins / TRIALS) * 100).toFixed(0)}%  平均被ダメ ${(hpLoss / TRIALS).toFixed(2)}  ` +
    `無傷率 ${((zeroTurns / TRIALS) * 100).toFixed(0)}%  連戦 ${chain.toFixed(1)} 戦${capped ? ` ← 打ち切り ${capped}/30!` : ''}`,
  );
}
}
