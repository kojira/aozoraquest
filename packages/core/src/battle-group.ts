/**
 * 群れの数 (D-PARTY-001)。追加の敵も本来の強さ。数は遭遇の seed から決めるので、同じマスの同じ 30 分なら同じ群れになる。
 * 確率は BATTLE_TUNING.groupChance の 1 か所だけ (t3 以上は t3 の値)。0 にすれば群れは消える。
 * 群れに入れない敵: fleer (群れでは敵の「逃げる」が通常攻撃に変わるので、はぐれスライムが逃げなくなる) と
 * レアな敵 (spawnWeight < 1)。主敵がそうなら 1 体のまま。
 */
import { BATTLE_TUNING } from './battle-tuning.js';
import type { MonsterDef, Tier } from './battle-monsters.js';

/** 群れに入れられる敵か。 */
export function groupable(def: MonsterDef): boolean {
  const abilities = def.abilities ?? (def.ability ? [def.ability] : []);
  return !abilities.includes('fleer') && (def.spawnWeight ?? 1) >= 1;
}

/** 遭遇の敵の数 (1〜3)。open = 群れを使えるようになったか (futaba_letter_done。呼び出し側が決める)。 */
export function encounterGroupSize(tier: Tier, seed: number, main: MonsterDef, open: boolean): number {
  if (!open || !groupable(main)) return 1;
  const chance = BATTLE_TUNING.groupChance;
  const [p2, p3] = chance[Math.min(3, tier) as keyof typeof chance];
  // seed の上位ビットを別のハッシュで混ぜて使う (敵の抽選と同じ乱数列にしない)。
  const r = (Math.imul((seed ^ 0x6a09e667) >>> 0, 2654435761) >>> 0) / 2 ** 32;
  return r < p3 ? 3 : r < p3 + p2 ? 2 : 1;
}
