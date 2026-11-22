/**
 * 群れの数 (D-PARTY-001・D-PARTY-005)。追加の敵も本来の強さ。数は遭遇の seed から決めるので、同じマスの同じ 30 分なら同じ群れになる。
 * 確率は BATTLE_TUNING.groupChance の 1 か所だけ (戦闘に出る人数 → tier → [2, 3, 4, 5 体])。0 にすれば群れは消える。
 * 群れに入れない敵: fleer (群れでは敵の「逃げる」が通常攻撃に変わるので、はぐれスライムが逃げなくなる) と
 * レアな敵 (spawnWeight < 1)。主敵がそうなら 1 体のまま。
 */
import { BATTLE_TUNING } from './battle-tuning.js';
import type { MonsterDef, Tier } from './battle-monsters.js';

/** 群れの最大の数 (D-PARTY-005)。 */
export const MAX_GROUP_SIZE = 5;

/** 群れに入れられる敵か。 */
export function groupable(def: MonsterDef): boolean {
  const abilities = def.abilities ?? (def.ability ? [def.ability] : []);
  return !abilities.includes('fleer') && (def.spawnWeight ?? 1) >= 1;
}

/** その人数・tier の [2 体, 3 体, 4 体, 5 体] の確率。人数は 1〜4 に丸め、tier は表にある一番近い下の tier。 */
export function groupChanceFor(tier: Tier, partySize: number): readonly [number, number, number, number] {
  const byTier = BATTLE_TUNING.groupChance[Math.max(1, Math.min(4, Math.floor(partySize))) as 1 | 2 | 3 | 4];
  for (let t = tier as number; t >= 1; t--) { const c = byTier[t]; if (c) return c; }
  return [0, 0, 0, 0];
}

/** 遭遇の敵の数 (1〜MAX_GROUP_SIZE)。open = 群れを使えるようになったか (futaba_letter_done。呼び出し側が決める)。
 *  partySize = この戦闘に出る人数 (主人公を含む)。 */
export function encounterGroupSize(tier: Tier, seed: number, main: MonsterDef, open: boolean, partySize: number): number {
  if (!open || !groupable(main)) return 1;
  const chance = groupChanceFor(tier, partySize);
  // seed の上位ビットを別のハッシュで混ぜて使う (敵の抽選と同じ乱数列にしない)。
  const r = (Math.imul((seed ^ 0x6a09e667) >>> 0, 2654435761) >>> 0) / 2 ** 32;
  // 大きい数から積む (1 人の 2・3 体は D-PARTY-001 と同じ seed で同じ数になる)。
  let acc = 0;
  for (let n = MAX_GROUP_SIZE; n >= 2; n--) { acc += chance[n - 2]!; if (r < acc) return n; }
  return 1;
}
