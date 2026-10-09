import {
  activeMonsters, baselineXp, battleXpFor, clearMonsters, JOBS, runAutoBattle, setMonsterOverrides, startBattle, type MonsterDef,
} from '@aozoraquest/core';

/**
 * モンスターエディタの模擬戦 (#419)。全 16 職 × 60 seed の勝率。
 * **編集中の値を一時適用して回し、終わったら模擬戦の前の値へ必ず戻す** — 戻さないと保存していない
 * 編集がワールド画面の戦闘にまで効いてしまう。前の値が 0 体なら 0 体へ戻す (D-MONSTER-001)。
 */
export function simulateMonsterWinRate(list: readonly MonsterDef[], def: MonsterDef): string {
  const prev = activeMonsters().map((m) => ({ ...m }));
  try {
    setMonsterOverrides(list);
    let wins = 0;
    let total = 0;
    for (const j of JOBS) {
      for (let seed = 0; seed < 60; seed++) {
        const r = runAutoBattle(startBattle(j.id, Math.max(1, (def.level ?? 1)), 1, 'x', def.tier, seed, 2, undefined, { monsterId: def.id }));
        total++;
        if (r.outcome === 'win') wins++;
      }
    }
    return `${def.name}: 想定 Lv での勝率 ${((wins / total) * 100).toFixed(0)}% (全職 × 60 seed) / XP ${battleXpFor(def.id)} (式なら ${baselineXp(def)})`;
  } finally {
    if (prev.length) setMonsterOverrides(prev); else clearMonsters();
  }
}
