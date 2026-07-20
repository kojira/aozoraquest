/**
 * tier1 (序盤) の遭遇率・討伐率・実効 XP を算出する分析スクリプト。
 *
 * 目的: はぐれメタル型 (低 HP・高 XP・毎ターン逃走) の XP を高く設定しても、
 * 「遭遇率 × 討伐率」で薄まるので序盤 XP を壊さないことを数値で確認する
 * (オーナー要望 2026-07-20: 実際の遭遇率と討伐率を算出して影響を見る)。
 *
 * 実行: pnpm exec tsx scripts/analyze-tier1-encounter.ts
 */
import { MONSTERS, summonMonster, startBattle, resolveTurn, battleXpFor } from '../packages/core/src/index.js';

const VARIANCE = 0.15; // world の monsterVitalsVariance

// 1) 遭遇分布 (empirical, tier1, Lv1)
const N = 200_000;
const counts: Record<string, number> = {};
for (let s = 0; s < N; s++) {
  const id = summonMonster(1, 1, s, 1, undefined, VARIANCE).def.id;
  counts[id] = (counts[id] ?? 0) + 1;
}
const tier1 = MONSTERS.filter((m) => m.tier === 1);
console.log(`=== tier1 遭遇分布 (Lv1, ${N} 回) ===`);
for (const m of tier1) {
  const c = counts[m.id] ?? 0;
  console.log(m.name.padEnd(12), `${((c / N) * 100).toFixed(2).padStart(6)}%`, `xp=${battleXpFor(m.id)}`);
}

// 2) はぐれスライム 討伐率 (毎ターン全力攻撃 = 倒しに行く。複数ジョブで平均)
const jobs = ['warrior', 'mage', 'guardian', 'ninja', 'fighter'] as const;
let killed = 0;
let fled = 0;
let trials = 0;
for (const job of jobs) {
  let found = 0;
  for (let seed = 0; seed < 200_000 && found < 600; seed++) {
    // variance は extras.vitalsVariance で渡す (第7引数は herbs)。world と同じ分散モデルで討伐率を測る。
    const b0 = startBattle(job, 1, 1, 't', 1, seed, 0, undefined, { vitalsVariance: VARIANCE });
    if (b0.monsterId !== 'stray-slime') continue;
    found++;
    trials++;
    let b = b0;
    for (let ts = 0; ts < 40; ts++) {
      b = resolveTurn(b, 'attack', ts);
      if (b.outcome === 'win') { killed++; break; }
      if (b.outcome === 'monster-fled') { fled++; break; }
      if (b.outcome === 'lose' || b.outcome === 'draw' || b.outcome === 'fled') break;
    }
  }
}
const killRate = killed / trials;
console.log(`\n=== はぐれスライム 討伐率 (全力攻撃, ${trials} 戦) ===`);
console.log(`倒せた: ${(killRate * 100).toFixed(1)}% / 逃げられた: ${((fled / trials) * 100).toFixed(1)}%`);

// 3) 実効 XP 寄与 = 遭遇率 × 討伐率 × XP
const encRate = (counts['stray-slime'] ?? 0) / N;
const slimeEnc = (counts['sky-slime'] ?? 0) / N;
console.log('\n=== 実効 XP 寄与 (1 遭遇あたり平均) ===');
console.log(`はぐれ  : 遭遇 ${(encRate * 100).toFixed(2)}% × 討伐 ${(killRate * 100).toFixed(0)}% × 100xp = ${(encRate * killRate * 100).toFixed(2)} xp/遭遇`);
console.log(`そらいろ: 遭遇 ${(slimeEnc * 100).toFixed(2)}% × 討伐 ~100% × 2xp = ${(slimeEnc * 2).toFixed(2)} xp/遭遇`);
let avgXp = 0;
for (const m of tier1) {
  const p = (counts[m.id] ?? 0) / N;
  const kr = m.id === 'stray-slime' ? killRate : 1;
  avgXp += p * kr * battleXpFor(m.id);
}
console.log(`\ntier1 平均 XP/遭遇 (討伐込み) ≈ ${avgXp.toFixed(2)} → JobLV2(30xp) まで約 ${Math.ceil(30 / avgXp)} 戦`);
