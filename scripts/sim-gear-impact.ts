/**
 * 装備込みバランスの実測 (docs/20「アイテム調整」の基礎数値)。
 * 実行: pnpm exec tsx scripts/sim-gear-impact.ts
 */
import { BATTLE_TUNING, resolveTurn, startBattle, type Archetype, type BattleState, type Command } from '../packages/core/src/index.js';
const play = (job: Archetype, jobLv: number, plLv: number, tier: 1|2|3, seed: number, equip: string[]) => {
  let s = startBattle(job, jobLv, plLv, 'x', tier, seed, BATTLE_TUNING.herbCarryMax, undefined, { equipIds: equip });
  const isParry = s.playerSkill.kind === 'parry';
  for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) {
    const p = s.player;
    const cmd: Command = s.monster.charging ? (isParry && p.mp >= 4 ? 'skill' : 'guard')
      : s.herbs > 0 && p.hp < p.maxHp * 0.45 ? 'herb'
      : !isParry && p.mp >= 4 ? 'skill' : 'attack';
    s = resolveTurn(s, cmd);
  }
  return s.outcome;
};
const rate = (job: Archetype, jobLv: number, plLv: number, tier: 1|2|3, equip: string[]) => {
  let w = 0; for (let seed = 0; seed < 300; seed++) if (play(job, jobLv, plLv, tier, seed, equip) === 'win') w++;
  return (w / 3).toFixed(1);
};
console.log('bard  tier2 jobLv5/plLv8  裸:', rate('bard',5,8,2,[]), '% → 竪琴+しあわせの衣:', rate('bard',5,8,2,['wp-bard-mid','ar-fortune']), '%');
console.log('bard  tier3 jobLv8/plLv15 裸:', rate('bard',8,15,3,[]), '% → 月夜の琴+衣+ペンダント:', rate('bard',8,15,3,['wp-bard-high','ar-fortune','ch-life']), '%');
console.log('miko  tier3 jobLv8/plLv15 裸:', rate('miko',8,15,3,[]), '% → 大神楽+ローブ+ペンダント:', rate('miko',8,15,3,['wp-miko-high','ar-scholar','ch-life']), '%');
console.log('warrior tier3 jobLv8/plLv15 裸:', rate('warrior',8,15,3,[]), '% → 剛剣+鉄鎧+ペンダント:', rate('warrior',8,15,3,['wp-warrior-high','ar-iron','ch-life']), '%');
console.log('shogun tier3 jobLv8/plLv15 裸:', rate('shogun',8,15,3,[]), '% → 大太刀+鉄鎧+ペンダント:', rate('shogun',8,15,3,['wp-shogun-high','ar-iron','ch-life']), '%');
