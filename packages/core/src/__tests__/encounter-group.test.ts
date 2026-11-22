/**
 * 群れ (D-PARTY-001 P4・D-PARTY-005)。敵は全員本来の強さ。数は遭遇の seed で決め、確率は BATTLE_TUNING.groupChance だけ。
 * - 1 人: t1 は 2 体まで (3 体は 0%)。t2 は 2/3 体、t3 以上は t3 の確率 (D-PARTY-001 のまま)
 * - 人数が多いほど群れが大きい。最大 5 体
 * - 群れを使えるようになる前 (open=false) は常に 1 体
 * - fleer・レア (spawnWeight<1) は群れに入らない (主敵がそうなら 1 体、追加の敵にも出ない)
 * - 同じ seed なら同じ群れ
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BATTLE_TUNING, encounterGroupSize, setMonsterOverrides, startBattle, MONSTERS_BY_ID, type MonsterDef } from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const mon = (id: string, tier: 1 | 2 | 3, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
const MONS = [mon('a', 1), mon('b', 1), mon('c', 1), mon('d', 2), mon('e', 2), mon('f', 3), mon('g', 3),
  mon('runner', 2, { ability: 'fleer' }), mon('rare', 2, { spawnWeight: 0.5 }), mon('runner3', 3, { abilities: ['healer', 'fleer'] })];
const count = (tier: 1 | 2 | 3 | 4 | 5 | 6, open = true, main = 'a', partySize = 1) => {
  const n = [0, 0, 0, 0, 0, 0];
  for (let seed = 0; seed < 4000; seed++) n[encounterGroupSize(tier, seed, MONSTERS_BY_ID[main]!, open, partySize)]! += 1;
  return n.map((x) => x / 4000);
};

describe('encounterGroupSize', () => {
  afterEach(() => setMonsterOverrides(TEST_MONSTERS));

  it('1 人: t1 は 2 体が約 8%、3 体は 0%。t2・t3 は groupChance のとおり。t4 は t3 と同じ。4 体以上は出ない', () => {
    setMonsterOverrides(MONS);
    expect(BATTLE_TUNING.groupChance[1]).toEqual({ 1: [0.08, 0, 0, 0], 2: [0.15, 0.03, 0, 0], 3: [0.25, 0.1, 0, 0] });
    const t1 = count(1);
    expect(t1[3]).toBe(0);
    expect(t1[2]).toBeGreaterThan(0.06); expect(t1[2]).toBeLessThan(0.1);
    const t2 = count(2, true, 'd');
    expect(t2[2]).toBeGreaterThan(0.13); expect(t2[2]).toBeLessThan(0.17);
    expect(t2[3]).toBeGreaterThan(0.02); expect(t2[3]).toBeLessThan(0.04);
    const t3 = count(3, true, 'f');
    expect(t3[3]).toBeGreaterThan(0.08); expect(t3[3]).toBeLessThan(0.12);
    expect(count(4, true, 'f')).toEqual(t3);
    expect(t3[4]! + t3[5]!).toBe(0);
  });

  it('1 人の群れは D-PARTY-001 と同じ seed で同じ数 (ソロの手ごたえを変えない)', () => {
    setMonsterOverrides(MONS);
    for (const [tier, p2, p3] of [[1, 0.08, 0], [2, 0.15, 0.03], [3, 0.25, 0.1]] as const) {
      for (let seed = 0; seed < 2000; seed++) {
        const r = (Math.imul((seed ^ 0x6a09e667) >>> 0, 2654435761) >>> 0) / 2 ** 32;
        expect(encounterGroupSize(tier, seed, MONSTERS_BY_ID['f']!, true, 1)).toBe(r < p3 ? 3 : r < p3 + p2 ? 2 : 1);
      }
    }
  });

  it('人数が多いほど群れが大きい: 2 人はよく 2 体、3〜4 人は 2〜4 体、5 体は t3 以上の 3〜4 人だけ。最大 5 体', () => {
    setMonsterOverrides(MONS);
    const mean = (n: number[]) => n.reduce((a, x, i) => a + x * i, 0);
    for (const tier of [1, 2, 3, 4, 5, 6] as const) {
      const by = [1, 2, 3, 4].map((p) => count(tier, true, 'f', p));
      for (let p = 1; p < 4; p++) expect(mean(by[p]!)).toBeGreaterThan(mean(by[p - 1]!));
      expect(by[1]![2]).toBeGreaterThan(0.15);
      expect(by[1]![4]! + by[1]![5]!).toBe(0);
      expect(by[3]![2]! + by[3]![3]! + by[3]![4]!).toBeGreaterThan(0.35);
      if (tier >= 3) expect(by[3]![5]).toBeGreaterThan(0);
      else expect(by[2]![5]! + by[3]![5]!).toBe(0);
      for (const n of by) expect(n.reduce((a, x) => a + x, 0)).toBeCloseTo(1);
    }
    // 人数は 1〜4 に丸める (5 人以上は 4 人、0 以下は 1 人)
    expect(count(3, true, 'f', 9)).toEqual(count(3, true, 'f', 4));
    expect(count(3, true, 'f', 0)).toEqual(count(3, true, 'f', 1));
  });

  it('startBattle の group は人数で数を決め、5 体の戦闘を作れる。extraEnemies も 4 (計 5 体) まで', () => {
    setMonsterOverrides(MONS);
    let five = 0;
    for (let seed = 0; seed < 4000 && !five; seed++) {
      const s = startBattle('warrior', 8, 8, 'x', 3, seed, 0, undefined, { group: { partySize: 4 } });
      const n = s.enemies?.length ?? 1;
      expect(n).toBe(encounterGroupSize(3, seed, MONSTERS_BY_ID[s.monsterId]!, true, 4));
      if (n === 5) five++;
    }
    expect(five).toBe(1);
    expect(startBattle('warrior', 8, 8, 'x', 3, 1, 0, undefined, { monsterId: 'f', extraEnemies: 4 }).enemies).toHaveLength(5);
    expect(startBattle('warrior', 8, 8, 'x', 3, 1, 0, undefined, { monsterId: 'f', extraEnemies: 9 }).enemies).toHaveLength(5);
  });

  it('群れを使えるようになる前は常に 1 体', () => {
    setMonsterOverrides(MONS);
    expect(count(3, false, 'f', 4)).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('主敵が fleer・レアなら 1 体', () => {
    setMonsterOverrides(MONS);
    for (const id of ['runner', 'rare']) expect(count(2, true, id, 4)).toEqual([0, 1, 0, 0, 0, 0]);
    expect(count(3, true, 'runner3', 4)).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('同じ seed なら同じ群れ (数も顔ぶれも)。追加の敵に fleer・レアは出ない', () => {
    setMonsterOverrides(MONS);
    let groups = 0;
    for (let seed = 0; seed < 400; seed++) {
      const a = startBattle('warrior', 8, 8, 'x', 2, seed, 0, undefined, { group: { partySize: 3 } });
      const b = startBattle('warrior', 8, 8, 'x', 2, seed, 0, undefined, { group: { partySize: 3 } });
      expect((a.enemies ?? [a.monster]).map((e) => [e.monsterId, e.maxHp])).toEqual((b.enemies ?? [b.monster]).map((e) => [e.monsterId, e.maxHp]));
      const n = encounterGroupSize(2, seed, MONSTERS_BY_ID[a.monsterId]!, true, 3);
      expect(a.enemies?.length ?? 1).toBe(n);
      if (n > 1) groups++;
      for (const e of (a.enemies ?? []).slice(1)) expect(['runner', 'rare']).not.toContain(e.monsterId);
    }
    expect(groups).toBeGreaterThan(30);
  });

  it('group を渡さなければ今のまま 1 体 (monsterId 固定・extraEnemies も今のまま)', () => {
    setMonsterOverrides(MONS);
    for (let seed = 0; seed < 200; seed++) expect(startBattle('warrior', 8, 8, 'x', 3, seed).enemies).toBeUndefined();
    expect(startBattle('warrior', 8, 8, 'x', 3, 1, 0, undefined, { monsterId: 'f', group: { partySize: 4 } }).enemies).toBeUndefined();
    expect(startBattle('warrior', 8, 8, 'x', 3, 1, 0, undefined, { monsterId: 'f', extraEnemies: 2 }).enemies).toHaveLength(3);
  });
});
